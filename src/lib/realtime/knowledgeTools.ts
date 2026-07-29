export const RETRIEVE_KNOWLEDGE_TOOL_NAME = 'retrieve_knowledge';

export const KNOWLEDGE_TOOL = {
  type: 'function',
  name: RETRIEVE_KNOWLEDGE_TOOL_NAME,
  description:
    'Search approved vertical and business-specific reference knowledge for a static informational question. ' +
    'Use this for questions about services, symptoms, maintenance, or policies when the answer is not already ' +
    'available in the session instructions. Never use it for live availability, appointments, inventory, ' +
    'customer records, or actions. Send only the caller question; tenant and vertical scope are resolved by the server.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "The caller's concise static informational question. Do not include tenant IDs or unrelated personal information.",
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
} as const;
