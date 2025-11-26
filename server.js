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
    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2025-10/products/${productId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
