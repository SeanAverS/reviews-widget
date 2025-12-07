import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import crypto from "crypto";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Load Permanent Token from Railway Variables 
const PERMANENT_TOKEN = process.env.SHOPIFY_PERMANENT_TOKEN;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN; 

// Load saved token and domain on startup
app.locals.shopToken = PERMANENT_TOKEN;
app.locals.shopDomain = SHOPIFY_SHOP_DOMAIN;

app.use(
  cors({
    origin: ["http://localhost:3001", `https://${SHOPIFY_SHOP_DOMAIN}`, "http://127.0.0.1:9292"],
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

 if (!token) { // railway failsafe 
      return res.status(503).send("Server initialization error: Shopify token unavailable.");
  }

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

    // --- DEBUG LOGS ---
    // const tokenMissing = !token;
    // const productIdMissing = !productId;
    // const ratingMissing = !rating; // True if rating is null, undefined, or 0
    // const ratingTooLow = rating < 1;
    // const ratingTooHigh = rating > 5;

    // console.log("--- SUBMISSION DEBUG START ---");
    // console.log(`Token Available: ${!!token}`);
    // console.log(`Product ID: ${productId}`);
    // console.log(`Rating Value: ${rating}`);
    // console.log(`Check 1: !token (${tokenMissing})`);
    // console.log(`Check 2: !productId (${productIdMissing})`);
    // console.log(`Check 3: !rating (${ratingMissing})`);
    // console.log(`Check 4: rating < 1 (${ratingTooLow})`);
    // console.log(`Check 5: rating > 5 (${ratingTooHigh})`);
    
    // const fullCondition = tokenMissing || productIdMissing || ratingMissing || ratingTooLow || ratingTooHigh;
    // console.log(`FULL CONDITION RESULT: ${fullCondition}`);
    // console.log("--- SUBMISSION DEBUG END ---");
    
    // if (fullCondition) {
    //     return res.status(400).send("Missing data or app not installed/invalid rating.");
    // }

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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
