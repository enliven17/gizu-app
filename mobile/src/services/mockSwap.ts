import {
  formatSwapAmount,
  mockSwapBalance,
  parseSwapAmount,
  swapAssets,
  type SwapOrder,
  type SwapQuote,
  type SwapService,
} from "@/domain/swap";

/** Development simulation only. No wallet, network, or signing dependencies. */
export function createMockSwapService(): SwapService {
  let sequence = 0;
  const orders = new Map<string, SwapOrder>();
  const quotes = new Map<string, SwapQuote>();
  let spent = 0n;
  return {
    async quote(symbol, amount) {
      const asset = swapAssets.find((item) => item.symbol === symbol);
      const input = parseSwapAmount(amount);
      if (!asset || input === null || input < 1000000n) throw new Error("Enter at least 1 USDG.");
      if (input + spent > mockSwapBalance) throw new Error("Not enough simulated USDG.");
      const output = input / asset.price;
      const quote = {
        id: `mock-quote-${++sequence}`,
        symbol,
        input: formatSwapAmount(input),
        output: formatSwapAmount(output),
        minimum: formatSwapAmount((output * 99n) / 100n),
        expiresAt: Date.now() + 60000,
      };
      quotes.set(quote.id, quote);
      return quote;
    },
    async submit(quote) {
      const existing = orders.get(quote.id);
      if (existing) return existing;
      const issued = quotes.get(quote.id);
      if (!issued || JSON.stringify(issued) !== JSON.stringify(quote))
        throw new Error("Request a new quote.");
      if (Date.now() >= issued.expiresAt)
        throw new Error("Quote expired. Go back and request a new quote.");
      const input = parseSwapAmount(issued.input)!;
      if (input + spent > mockSwapBalance) throw new Error("Not enough simulated USDG.");
      spent += input;
      const order: SwapOrder = { id: quote.id, quote: issued, status: "pending" };
      orders.set(order.id, order);
      return order;
    },
    async status(id) {
      const order = orders.get(id);
      if (!order) throw new Error("Simulation not found.");
      const filled: SwapOrder = { ...order, status: "filled" };
      orders.set(id, filled);
      return filled;
    },
  };
}
