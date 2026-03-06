import type { CLIToolDefinition } from '@personalclaw/shared';

export const CLI_REGISTRY: readonly CLIToolDefinition[] = [
  {
    name: 'aws_cli',
    binary: 'aws',
    description:
      'Execute a read-only AWS CLI command. ' +
      'Only read operations are allowed (describe, list, get, head, s3 ls). ' +
      'Provide arguments without the "aws" prefix.',
    allowedPatterns: [
      /^s3 ls\b/,
      /^s3 cp s3:\/\//,
      /^s3api\s+(get|list|head)-/,
      /^ec2\s+describe-/,
      /^iam\s+(list|get)-/,
      /^sts\s+get-caller-identity/,
      /^cloudwatch\s+(list|get|describe)-/,
      /^logs\s+(describe|get|filter)-/,
      /^lambda\s+(list|get)-/,
      /^rds\s+describe-/,
      /^dynamodb\s+(describe|list|get|query|scan)\b/,
      /^sqs\s+(list|get)-/,
      /^sns\s+(list|get)-/,
      /^route53\s+(list|get)-/,
      /^elbv2\s+describe-/,
      /^ecs\s+(list|describe)-/,
      /^eks\s+(list|describe)-/,
      /^cloudformation\s+(list|describe|get)-/,
      /^ssm\s+(list|describe|get)-/,
      /^secretsmanager\s+(list|describe|get)-/,
    ],
    deniedPatterns: [
      /\b(put|delete|create|update|modify|remove|terminate|stop|start|reboot|run|invoke|send|publish|tag|untag)-/,
      /^s3\s+(rm|mb|rb|mv|sync)\b/,
      /^s3\s+cp\s+(?!s3:\/\/)/,
      /--cli-input/,
    ],
    timeoutMs: 30_000,
  },
  {
    name: 'github_cli',
    binary: 'gh',
    description:
      'Execute a read-only GitHub CLI command. ' +
      'Only read operations are allowed (list, view, diff, checks, status). ' +
      'Provide arguments without the "gh" prefix.',
    allowedPatterns: [
      /^repo\s+(list|view|clone)\b/,
      /^issue\s+(list|view|status)\b/,
      /^pr\s+(list|view|diff|checks|status)\b/,
      /^release\s+(list|view)\b/,
      /^run\s+(list|view)\b/,
      /^workflow\s+(list|view)\b/,
      /^gist\s+(list|view)\b/,
      /^search\s+(repos|issues|prs|commits|code)\b/,
      /^api\s+/,
    ],
    deniedPatterns: [
      /^repo\s+(create|delete|edit|fork|rename|archive)\b/,
      /^issue\s+(create|close|reopen|edit|delete|transfer|pin|unpin)\b/,
      /^pr\s+(create|close|merge|edit|ready|review)\b/,
      /^release\s+(create|delete|edit)\b/,
      /^run\s+(cancel|rerun|delete)\b/,
      /^workflow\s+(enable|disable|run)\b/,
      /^gist\s+(create|edit|delete)\b/,
      /^api\s+.*(-X\s+(POST|PUT|PATCH|DELETE)|--method\s+(POST|PUT|PATCH|DELETE))/i,
    ],
    timeoutMs: 30_000,
  },
  {
    name: 'curl_fetch',
    binary: 'curl',
    description:
      'Fetch content from a URL using curl (GET requests only). ' +
      'Provide arguments without the "curl" prefix. ' +
      'The -s (silent) and --max-time 30 flags are added automatically.',
    allowedPatterns: [/./],
    deniedPatterns: [
      /(-X|--request)\s+(POST|PUT|PATCH|DELETE)/i,
      /(-d|--data|--data-raw|--data-binary|--data-urlencode)\s/,
      /--upload-file\b/,
      /(-F|--form)\s/,
      /-T\s/,
    ],
    timeoutMs: 30_000,
    env: {},
  },
] as const;
