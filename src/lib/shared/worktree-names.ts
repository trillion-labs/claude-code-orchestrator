const ADJECTIVES = [
  "amazing", "bold", "calm", "daring", "eager", "fierce", "gentle",
  "happy", "idle", "jolly", "keen", "lively", "merry", "noble",
  "proud", "quiet", "rapid", "sharp", "tall", "vivid", "warm",
  "zealous", "bright", "clever", "deft", "epic", "fast", "grand",
  "hardy", "iron", "jade", "kind", "lucid", "mighty", "neat",
  "odd", "prime", "quick", "rare", "sage", "true", "ultra",
  "vast", "wise", "young", "agile", "brave", "crisp", "deep",
];

const NOUNS = [
  "khayyam", "euler", "gauss", "newton", "turing", "lovelace",
  "curie", "darwin", "tesla", "faraday", "kepler", "pascal",
  "fermat", "galois", "hilbert", "cantor", "riemann", "fourier",
  "laplace", "lagrange", "cauchy", "abel", "jacobi", "dirac",
  "planck", "bohr", "fermi", "feynman", "hawking", "noether",
  "hypatia", "ramanujan", "erdos", "mandelbrot", "leibniz",
  "archimedes", "fibonacci", "descartes", "ptolemy", "copernicus",
  "babbage", "shannon", "neumann", "dijkstra", "knuth", "hopper",
  "bernoulli", "poisson", "markov", "bayes",
];

export function generateWorktreeName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}
