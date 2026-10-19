import("./server.mjs").catch((error) => {
  console.error("[server] bootstrap failed", error);
  process.exit(1);
});
