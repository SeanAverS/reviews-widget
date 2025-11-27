import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// fetch product data
app.get("/reviews/:productId", async (req, res) => {
  const { productId } = req.params;

  try {
    const metafieldResponse = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/products/${productId}/metafields.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const metafieldData = await metafieldResponse.json();
    console.log("Metafields:", metafieldData);

    // extract product star rating 
    const starField = metafieldData.metafields.find(
      (field) => field.namespace === "custom" && field.key === "star_ratings"
    );

    let starRatings = starField?.value ? JSON.parse(starField.value) : [];

    const avgRating =
      starRatings.length > 0
        ? starRatings.reduce((a, b) => a + b, 0) / starRatings.length
        : 0;

    res.json({ starRatings, avgRating });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
