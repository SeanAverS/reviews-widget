import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import crypto from "crypto";
import mongoose from "mongoose";

const app = express();
const PORT = process.env.PORT || 3000;


// Shop credentials Schema 
const shopSchema = new mongoose.Schema({
    shopDomain: { type: String, required: true, unique: true }, 
    accessToken: { type: String, required: true },
}, { timestamps: true });

const Shop = mongoose.model('Shop', shopSchema);

app.use(
  cors({
    origin: ["http://localhost:3001", "https://sean-dev-2.myshopify.com", "http://127.0.0.1:9292"],
    methods: "GET,POST,PUT,DELETE",
    allowedHeaders: "Content-Type,Authorization",
  })
);

app.use(express.json());

// update a metafield
async function updateMetafield(shop, token, productId, namespace, key, value, type) {
    const payload = {
        metafield: {
            namespace,
            key,
            value,
            type,
            owner_resource: "product",
            owner_id: productId
        }
    };
    const response = await fetch(
        `https://${shop}/admin/api/2025-01/metafields.json`,
        {
            method: "POST",
            headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }
    );
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save metafield ${namespace}.${key}: ${errorText}`);
    }
}

// OAuth after Shopify installion
app.get("/", (req, res) => {
    const shop = req.query.shop;
    if (shop) {
        res.redirect(`/auth?shop=${shop}`); 
    } else {
        res.status(400).send("Missing shop parameter.");
    }
});

// OAuth for store owner 
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing shop parameter");

  const scopes = "read_products,write_products";
  // **MAKE SURE THIS IS RIGHT REDIRECT URI FOR RAILWAY **
  const redirectUri = `https://reviews-widget-production.up.railway.app/auth/callback`; 
  const state = crypto.randomBytes(16).toString("hex");

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

  res.redirect(installUrl);
});

// OAuth callback 
app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send("Missing parameters");

  // get OAuth token (Shopify API requests)
  try {
    const tokenResponse = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.SHOPIFY_API_KEY,
          client_secret: process.env.SHOPIFY_API_SECRET,
          code,
        }),
      }
    );

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token; 

    // save token and shop domain to MongoDB 
    await Shop.findOneAndUpdate(
        { shopDomain: shop }, 
        { accessToken: accessToken }, 
        { upsert: true, new: true, setDefaultsOnInsert: true } 
    );

    res.send("App installed! Credentials saved to database. Reviews endpoint now working.");
  } catch (err) {
    console.error("OAuth failed:", err);
    res.status(500).send("OAuth failed");
  }
});

// submit and calculate new rating 
app.post("/submit-rating", async (req, res) => {
    // get shopDomain from request body (Liquid frontend)
    const { productId, rating, shopDomain } = req.body; 

    // look up MongoDB credentials 
    const shopEntry = await Shop.findOne({ shopDomain: shopDomain });
    
    if (!shopEntry) {
        return res.status(401).send("App not installed on this shop.");
    }
    
    // MongoDB variables 
    const token = shopEntry.accessToken; 
    const shop = shopDomain; 
    
    if (!productId || !rating || rating < 1 || rating > 5) {
        return res.status(400).send("Missing product ID or invalid rating (must be 1-5).");
    }

    try {
        // fetch existing star ratings (custom.star_ratings)
        const rawMetafieldResponse = await fetch(
            `https://${shop}/admin/api/2025-01/products/${productId}/metafields.json`,
            {
              headers: { "X-Shopify-Access-Token": token }
            }
        );

        const rawMetafieldData = await rawMetafieldResponse.json();
        const rawStarField = rawMetafieldData.metafields.find(
          (field) => field.namespace === "custom" && field.key === "star_ratings"
        );
        
        let starRatings = [];
        if (rawStarField && rawStarField.value) {
            try {
                // Ensure correct parsing of the JSON array
                starRatings = JSON.parse(rawStarField.value); 
            } catch (e) {
                console.error("Error parsing existing starRatings JSON:", e.message);
            }
        }
        
        // Add and calculate new rating 
        starRatings.push(rating);
        const totalStars = starRatings.reduce((a, b) => a + b, 0);
        const totalRatings = starRatings.length;
        
        const newAvgRating = totalStars / totalRatings;
        const newAvgRatingString = newAvgRating.toFixed(1);
        const totalRatingsString = totalRatings.toString(); 

        // update raw ratings (custom.star_ratings) 
        await updateMetafield(
            shop, 
            token, 
            productId, 
            "custom", 
            "star_ratings", 
            JSON.stringify(starRatings), 
            "json"
        );

        // update the average rating (reviews.average_rating)
        await updateMetafield(
            shop, 
            token, 
            productId, 
            "reviews", 
            "average_rating", 
            newAvgRatingString, 
            "number_decimal"
        );
        
        // Update the total rating count (reviews.total_ratings) 
        await updateMetafield(
            shop, 
            token, 
            productId, 
            "reviews", 
            "total_ratings", 
            totalRatingsString, 
            "number_integer" 
        );

        res.json({ success: true, newAvgRating: newAvgRatingString, totalRatings: totalRatings}); 

    } catch (err) {
        console.error("Error submitting rating:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// handle database connection and server startup
async function startServer() {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
        console.error("FATAL ERROR: MONGODB_URI environment variable is missing!");
        console.error("Check Railway Shared Variables spelling: MONGODB_URI");
        process.exit(1); 
    }

    try {
        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('Successfully connected to MongoDB!');

        // Start Express ONLY after database connects
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

    } catch (err) {
        console.error('Failed to start server due to MongoDB connection error:', err);
        process.exit(1);
    }
}

startServer();
