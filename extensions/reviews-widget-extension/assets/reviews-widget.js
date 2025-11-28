document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("reviews-widget-container");
  if (!el) return;

  const productId = el.dataset.productId;

  async function loadRating() {
    try {
      const res = await fetch(`https://nonhuman-kathryn-topazine.ngrok-free.dev/reviews/${productId}`);
      const data = await res.json();

      const avg = data.avgRating || 0;
      const count = data.starRatings?.length || 0;

      if (count === 0) {
        el.innerHTML = `<p>No ratings yet.</p>`;
        return;
      }

      el.innerHTML = `
        <div style="font-size: 18px; font-weight: bold;">
          ${avg.toFixed(1)} / 5 ⭐
        </div>
        <p>Based on ${count} review${count > 1 ? "s" : ""}</p>
      `;
    } catch (err) {
      console.error("Rating error:", err);
      el.innerHTML = `<p>Error loading rating.</p>`;
    }
  }

  loadRating();
});
