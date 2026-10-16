// Runs only the mock LegendKeeper (API + asset host), e.g. for `wrangler dev`.
import { API_KEY, startMockLk } from "./mockLk.js";

const lk = await startMockLk(Number(process.env.MOCK_LK_PORT ?? 8790));
console.log(`Mock LegendKeeper on ${lk.baseUrl} (API key ${API_KEY})`);
