import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import crypto from "crypto";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// load saved token on startup
let savedToken = null;
app.locals.shopToken = savedToken;

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
    app.locals.shopToken = tokenData.access_token;
    app.locals.shopDomain = shop;

    res.send("App installed! Reviews endpoint now working.");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth failed");
  }
});

// Fetch star ratings with OAuth token 
app.get("/reviews/:productId", async (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Expires": "0",
  });

  const { productId } = req.params;
  const token = app.locals.shopToken;
  const shop = app.locals.shopDomain;

  if (!token) return res.status(400).send("Install app first via /auth");

  try {
    const metafieldResponse = await fetch(
      `https://${shop}/admin/api/2025-01/products/${productId}/metafields.json`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    const metafieldData = await metafieldResponse.json();

    // make sure metafields exists
    const metafields = metafieldData.metafields || [];

    const starField = metafields.find(
      (field) => field.namespace === "custom" && field.key === "star_ratings"
    );

    // Calculate average rating
    const starRatings = starField?.value ? JSON.parse(starField.value) : [];
    const avgRating =
      starRatings.length > 0
        ? starRatings.reduce((a, b) => a + b, 0) / starRatings.length
        : 0;

  // save average rating 
    try {
      await updateMetafield(
        shop, 
        token, 
        productId, 
        "reviews", 
        "average_rating", 
        avgRating.toFixed(1), 
        "number_decimal"
      );
    } catch (saveError) {
      console.error("Error saving average rating metafield:", saveError);
    }

    res.json({ starRatings, avgRating });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// submit and calculate new rating 
app.post("/submit-rating", async (req, res) => {
    const { productId, rating } = req.body;
    const token = app.locals.shopToken;
    const shop = app.locals.shopDomain;

    if (!token || !productId || !rating || rating < 1 || rating > 5) {
        return res.status(400).send("Missing data or app not installed/invalid rating.");
    }

    // fetch existing star ratings (custom.star_ratings)
    try {
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
                starRatings = JSON.parse(rawStarField.value); 
            } catch (e) {
                console.error("Error parsing existing starRatings JSON:", e.message);
            }
        }
        
        // Push the new rating (already verified as 1-5 integer by the controller)
        starRatings.push(rating);

        // recalculate and prepare new average rating
        const totalStars = starRatings.reduce((a, b) => a + b, 0);
        const newAvgRating = totalStars / starRatings.length;
        const newAvgRatingString = newAvgRating.toFixed(1);

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

        res.json({ success: true, newAvgRating: newAvgRatingString});

    } catch (err) {
        console.error("Error submitting rating:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
