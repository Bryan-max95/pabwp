/** Public fixture identifiers only; definitive amounts are selected on the server. */
export const HNL_DEMO_SCENARIOS = ['hnl100', 'hnl150', 'hnl200'] as const;
export const DEMO_SCENARIOS = ['usd199', ...HNL_DEMO_SCENARIOS, 'hnl1000'] as const;
export const DEFAULT_DEMO_SCENARIO = 'usd199';
// Historical BAC diagnostics use these HNL amounts explicitly.
export const DEMO_CURRENCY = 'HNL';
export type DemoScenario = typeof DEMO_SCENARIOS[number];
export const DEMO_AMOUNTS: Record<DemoScenario, string> = {
  usd199: '199.00', hnl100: '100.00', hnl150: '150.00', hnl200: '200.00', hnl1000: '1000.00',
};

export function demoCurrency(scenario: DemoScenario) { return scenario === 'usd199' ? 'USD' : 'HNL'; }

export function demoScenarioForAmount(amount: string, currency = 'HNL'): DemoScenario | undefined {
  return DEMO_SCENARIOS.find(scenario => DEMO_AMOUNTS[scenario] === amount && demoCurrency(scenario) === currency);
}
