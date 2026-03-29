export function getStrategyParamOverrides(
  strategyParams: Record<string, Record<string, unknown>> | undefined,
  strategyId: string,
): Record<string, unknown> | undefined {
  const overrides = strategyParams?.[strategyId];
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return undefined;
  }

  return structuredClone(overrides);
}

export function resolveStrategyParams<TParams extends Record<string, unknown>>(
  defaults: TParams,
  overrides?: Record<string, unknown>,
): TParams {
  const base = structuredClone(defaults);
  if (!overrides) {
    return base;
  }

  return {
    ...base,
    ...structuredClone(overrides),
  };
}
