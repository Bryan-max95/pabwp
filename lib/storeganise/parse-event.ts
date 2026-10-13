/**
 * Safely parses and extracts the event type from the Storeganise webhook body.
 */
export function parseEvent(body: any): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  // Storeganise webhooks usually declare the event in the 'event' field or 'type' field.
  // We check multiple fallback properties to ensure maximum compatibility.
  const event = body.event || body.eventType || body.type || body.action || null;

  if (typeof event === "string") {
    return event;
  }

  return null;
}
