export interface RealtimeTopicBroker<TEvent> {
  publish(topic: string, event: TEvent): void;
  subscribe(
    topic: string,
    subscriber: (event: TEvent) => void,
    options?: { replay?: boolean },
  ): () => void;
  replay(topic: string): TEvent[];
  clear(topic: string): void;
}

type TopicState<TEvent> = {
  history: TEvent[];
  subscribers: Set<(event: TEvent) => void>;
};

type BrokerState<TEvent> = Map<string, TopicState<TEvent>>;

type BrokerGlobal = typeof globalThis & Record<string, BrokerState<unknown> | undefined>;

function getBrokerState<TEvent>(globalKey: string) {
  const globalStore = globalThis as BrokerGlobal;
  const existingState = globalStore[globalKey];
  if (existingState instanceof Map) {
    return existingState as BrokerState<TEvent>;
  }

  const nextState = new Map<string, TopicState<TEvent>>();
  globalStore[globalKey] = nextState as BrokerState<unknown>;
  return nextState;
}

function getTopicState<TEvent>(
  state: BrokerState<TEvent>,
  topic: string,
) {
  const existingTopicState = state.get(topic);
  if (existingTopicState) {
    return existingTopicState;
  }

  const nextTopicState: TopicState<TEvent> = {
    history: [],
    subscribers: new Set(),
  };
  state.set(topic, nextTopicState);
  return nextTopicState;
}

export function createInMemoryRealtimeTopicBroker<TEvent>(
  globalKey: string,
  options?: { historyLimit?: number },
): RealtimeTopicBroker<TEvent> {
  const historyLimit = Math.max(1, options?.historyLimit ?? 200);

  return {
    publish(topic, event) {
      const state = getBrokerState<TEvent>(globalKey);
      const topicState = getTopicState(state, topic);
      topicState.history.push(event);
      if (topicState.history.length > historyLimit) {
        topicState.history.splice(0, topicState.history.length - historyLimit);
      }

      for (const subscriber of topicState.subscribers) {
        try {
          subscriber(event);
        } catch (error) {
          console.error("Realtime topic subscriber error:", error);
        }
      }
    },

    subscribe(topic, subscriber, options) {
      const state = getBrokerState<TEvent>(globalKey);
      const topicState = getTopicState(state, topic);
      topicState.subscribers.add(subscriber);

      if (options?.replay) {
        for (const event of topicState.history) {
          try {
            subscriber(event);
          } catch (error) {
            console.error("Realtime topic replay subscriber error:", error);
          }
        }
      }

      return () => {
        topicState.subscribers.delete(subscriber);
        if (topicState.subscribers.size === 0 && topicState.history.length === 0) {
          state.delete(topic);
        }
      };
    },

    replay(topic) {
      const state = getBrokerState<TEvent>(globalKey);
      return [...(state.get(topic)?.history || [])];
    },

    clear(topic) {
      const state = getBrokerState<TEvent>(globalKey);
      state.delete(topic);
    },
  };
}
