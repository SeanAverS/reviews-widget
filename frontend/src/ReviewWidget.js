import React, { useEffect, useState } from "react";

export default function ReviewWidget({ productId }) {
  const [avgRating, setAvgRating] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRatings() {
      try {
        const res = await fetch(`https://nonhuman-kathryn-topazine.ngrok-free.dev/reviews/${productId}`);

        setAvgRating(data.avgRating || 0);
        setCount(data.starRatings.length || 0);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchRatings();
  }, [productId]);

  if (loading) return <p>Loading ratings...</p>;
  if (count === 0) return <p>No ratings yet.</p>;

  return (
    <div>
      <h3>
        Average Rating: {avgRating.toFixed(1)} / 5 ⭐
      </h3>
      <p>Based on {count} review{count > 1 ? "s" : ""}</p>
    </div>
  );
}
