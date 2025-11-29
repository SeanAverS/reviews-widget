import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";

dotenv.config();
const app = express();
const PORT = 3000;

// load saved token on startup
let savedToken = null;
try {
  if (fs.existsSync("token.json")) {
    const file = JSON.parse(fs.readFileSync("token.json", "utf8"));
    savedToken = file.access_token;
    console.log("Loaded saved OAuth token.");
  }
} catch (err) {
  console.error("Failed to load token.json:", err);
}

app.locals.shopToken = savedToken;

app.use(
  cors({
    origin: ["http://localhost:3001", "https://sean-dev-2.myshopify.com"],
    methods: "GET,POST,PUT,DELETE",
    allowedHeaders: "Content-Type,Authorization",
  })
);

app.use(express.json());

// OAuth for store owner 
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing shop parameter");

  const scopes = "read_products,write_products";
  const redirectUri = `http://localhost:${PORT}/auth/callback`;
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

    // Save token in token.json for future startups
    try {
      fs.writeFileSync("token.json", JSON.stringify(tokenData, null, 2));
      console.log("Saved OAuth token to token.json");
    } catch (err) {
      console.error("Failed to save token.json:", err);
    }

    res.send("App installed! Reviews endpoint now working.");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth failed");
  }
});

// Fetch star ratings with OAuth token 
app.get("/reviews/:productId", async (req, res) => {
  const { productId } = req.params;
  const token = app.locals.shopToken;
  const shop = "sean-dev-2.myshopify.com";

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
    console.log("Metafields:", metafieldData);

    // make sure metafields exists
    const metafields = metafieldData.metafields || [];

    const starField = metafields.find(
      (field) => field.namespace === "custom" && field.key === "star_ratings"
    );

    const starRatings = starField?.value ? JSON.parse(starField.value) : [];
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
