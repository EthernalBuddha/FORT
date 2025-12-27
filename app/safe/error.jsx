"use client";

export default function Error({ reset }) {
  return (
    <div className="card">
      <h2>Something went wrong</h2>
      <button className="btn" onClick={() => reset()}>Retry</button>
    </div>
  );
}
