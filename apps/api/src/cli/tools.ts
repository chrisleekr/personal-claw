import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import { executeCLI } from './executor';
import { CLI_REGISTRY } from './registry';
import { validateCommand } from './validator';

export function getCLITools(): ToolSet {
  return Object.fromEntries(
    CLI_REGISTRY.map((def) => [
      def.name,
      tool({
        description: def.description,
        inputSchema: z.object({
          command: z
            .string()
            .describe(
              `Arguments to pass to "${def.binary}" (the binary name is prepended automatically)`,
            ),
        }),
        execute: async ({ command }) => {
          const validation = validateCommand(command, def);
          if (!validation.valid) {
            return { error: true, message: `Command blocked: ${validation.reason}` };
          }
          return executeCLI(def, command);
        },
      }),
    ]),
  );
}
