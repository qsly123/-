export interface SceneStreamRuntime<TSnapshot, TDomainEvent, TStreamEvent> {
  getInitialEvents: () => Promise<TStreamEvent[]> | TStreamEvent[];
  subscribe: (
    subscriber: (event: TStreamEvent) => void,
  ) => Promise<() => void> | (() => void);
  __types?: {
    snapshot?: TSnapshot;
    domainEvent?: TDomainEvent;
  };
}

export function createSceneStreamRuntime<TSnapshot, TDomainEvent, TStreamEvent>(
  runtime: SceneStreamRuntime<TSnapshot, TDomainEvent, TStreamEvent>,
) {
  return runtime;
}
