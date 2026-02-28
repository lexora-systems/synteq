import { PubSub, type Topic } from "@google-cloud/pubsub";
import { config } from "../config.js";

let client: PubSub | null = null;
const topicCache = new Map<string, Topic>();

function getClient(): PubSub {
  if (!client) {
    client = new PubSub({
      projectId: config.PUBSUB_PROJECT_ID ?? config.BIGQUERY_PROJECT_ID
    });
  }

  return client;
}

export function getTopic(topicName: string): Topic {
  const cached = topicCache.get(topicName);
  if (cached) {
    return cached;
  }

  const topic = getClient().topic(topicName);
  topicCache.set(topicName, topic);
  return topic;
}
