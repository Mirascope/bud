import { Args, Command, CommandDescriptor, HelpDoc, Usage } from "@effect/cli";
import { Console } from "effect";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Command generics are internal to @effect/cli.
type AnyCommand = Command.Command<any, any, any, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Descriptor internals are not exported.
type Descriptor = any;

function helpDocText(doc: unknown): string {
  if (!doc || (doc as { _tag?: string })._tag === "Empty") return "";
  return HelpDoc.toAnsiText(doc as HelpDoc.HelpDoc).trim();
}

function findStandard(desc: Descriptor): Descriptor | null {
  if (!desc) return null;
  if (desc._tag === "Standard") return desc;
  if (desc._tag === "Map") return findStandard(desc.command);
  if (desc._tag === "Subcommands") return findStandard(desc.parent);
  return null;
}

type OptionEntry = {
  readonly name: string;
  readonly placeholder: string;
  readonly description: string;
  readonly optional: boolean;
};

function collectOptions(node: Descriptor, optional = false): OptionEntry[] {
  if (!node) return [];
  switch (node._tag) {
    case "Empty":
      return [];
    case "Single":
      return [
        {
          name: node.name,
          placeholder:
            node.primitiveType?._tag === "Choice"
              ? node.primitiveType.alternatives
                  .map((alternative: [string, unknown]) => alternative[0])
                  .join(" | ")
              : node.placeholder,
          description: helpDocText(node.description),
          optional,
        },
      ];
    case "Both":
    case "OrElse":
      return [
        ...collectOptions(node.left, optional),
        ...collectOptions(node.right, optional),
      ];
    case "Map":
      return collectOptions(node.options, optional);
    case "WithDefault":
    case "WithFallback":
      return collectOptions(node.options, true);
    case "Variadic":
      return collectOptions(node.options, optional);
    default:
      return [];
  }
}

type ArgEntry = {
  readonly name: string;
  readonly description: string;
  readonly repeated: boolean;
};

function collectArgs(node: Descriptor, repeated = false): ArgEntry[] {
  if (!node) return [];
  switch (node._tag) {
    case "Empty":
      return [];
    case "Single": {
      const name =
        node.pseudoName?._tag === "Some"
          ? node.pseudoName.value
          : (node.name?.replace(/[<>]/g, "") ?? "arg");
      return [{ name, description: helpDocText(node.description), repeated }];
    }
    case "Both":
      return [
        ...collectArgs(node.left, repeated),
        ...collectArgs(node.right, repeated),
      ];
    case "Map":
      return collectArgs(node.args, repeated);
    case "Variadic":
      return collectArgs(node.args, true);
    case "WithDefault":
      return collectArgs(node.args, repeated);
    default:
      return [];
  }
}

function isGroup(desc: Descriptor): boolean {
  if (!desc) return false;
  if (desc._tag === "Subcommands") return true;
  if (desc._tag === "Map") return isGroup(desc.command);
  return false;
}

function buildCommandEntries(children: Descriptor[]): [string, string][] {
  const entries: [string, string][] = [];
  for (const child of children) {
    const std = findStandard(child);
    if (!std) continue;

    const description = helpDocText(std.description);
    if (description) {
      entries.push([std.name, description]);
      continue;
    }

    const usage = CommandDescriptor.getUsage(
      child as CommandDescriptor.Command<unknown>,
    );
    const usageText = HelpDoc.toAnsiText(Usage.getHelp(usage)).trim();
    const usagePart = usageText.startsWith(std.name)
      ? usageText.slice(std.name.length).trim()
      : usageText;
    entries.push([std.name, usagePart]);
  }
  return entries;
}

function formatCommandEntries(entries: [string, string][]): string {
  const maxNameLength = Math.max(...entries.map(([name]) => name.length));
  const lines = entries.map(
    ([name, display]) => `  ${name.padEnd(maxNameLength + 2)}${display}`,
  );
  return `COMMANDS\n\n${lines.join("\n")}`;
}

function renderLeafHelp(displayPath: string, desc: Descriptor): string {
  const std = findStandard(desc);
  if (!std) return `${displayPath}: no help available`;

  const description = helpDocText(std.description);
  const options = collectOptions(std.options);
  const args = collectArgs(std.args);
  const lines: string[] = [displayPath];

  if (description) {
    lines.push("");
    lines.push(description);
  }

  const usageParts = [displayPath];
  for (const arg of args) {
    usageParts.push(arg.repeated ? `<${arg.name}>...` : `<${arg.name}>`);
  }
  for (const option of options) {
    const flag = `--${option.name} ${option.placeholder}`;
    usageParts.push(option.optional ? `[${flag}]` : flag);
  }
  lines.push("");
  lines.push("USAGE");
  lines.push("");
  lines.push(`  ${usageParts.join(" ")}`);

  if (args.length > 0) {
    lines.push("");
    lines.push("ARGUMENTS");
    lines.push("");
    const maxArgLength = Math.max(...args.map((arg) => arg.name.length));
    for (const arg of args) {
      const suffix = arg.repeated ? "..." : "";
      const descriptionSuffix = arg.description ? `  ${arg.description}` : "";
      lines.push(
        `  ${(arg.name + suffix).padEnd(maxArgLength + 4)}${descriptionSuffix}`.trimEnd(),
      );
    }
  }

  if (options.length > 0) {
    lines.push("");
    lines.push("OPTIONS");
    lines.push("");
    const maxOptionLength = Math.max(
      ...options.map(
        (option) => `--${option.name} ${option.placeholder}`.length,
      ),
    );
    for (const option of options) {
      const flag = `--${option.name} ${option.placeholder}`;
      const parts: string[] = [];
      if (option.description) parts.push(option.description);
      if (option.optional) parts.push("optional");
      const suffix = parts.length > 0 ? `  ${parts.join(", ")}` : "";
      lines.push(`  ${flag.padEnd(maxOptionLength + 2)}${suffix}`);
    }
  }

  return lines.join("\n");
}

function resolveInDescriptor(
  desc: Descriptor,
  path: string[],
):
  | { readonly kind: "found"; readonly desc: Descriptor }
  | { readonly kind: "not-found"; readonly available: readonly string[] }
  | null {
  if (!desc) return null;
  if (desc._tag === "Map") return resolveInDescriptor(desc.command, path);
  if (desc._tag === "Standard" && path.length === 0) {
    return { kind: "found", desc };
  }
  if (desc._tag === "Subcommands") {
    if (path.length === 0) return { kind: "found", desc };
    const [next, ...rest] = path;
    const children: Descriptor[] = desc.children ?? [];
    for (const child of children) {
      const std = findStandard(child);
      if (std?.name === next) {
        return rest.length === 0
          ? { kind: "found", desc: child }
          : resolveInDescriptor(child, rest);
      }
    }
    return {
      kind: "not-found",
      available: children
        .map((child) => findStandard(child)?.name)
        .filter((name): name is string => Boolean(name)),
    };
  }
  return null;
}

function renderGroupHelp(desc: Descriptor, path: string[], rootName: string) {
  const unwrapped =
    desc._tag === "Map" && desc.command?._tag === "Subcommands"
      ? desc.command
      : desc;
  const children: Descriptor[] = unwrapped.children ?? [];
  const entries = buildCommandEntries(children);
  const fullPath = [rootName, ...path].join(" ");
  const std = findStandard(desc);
  const description = std ? helpDocText(std.description) : "";
  const lines = [fullPath];

  if (description) {
    lines.push("");
    lines.push(description);
  }

  lines.push("");
  lines.push(`Run '${fullPath} <command> --help' for details.`);

  return `${lines.join("\n")}\n\n${formatCommandEntries(entries)}`;
}

function renderHelp(
  rootName: string,
  desc: Descriptor,
  path: string[],
): string {
  if (isGroup(desc)) return renderGroupHelp(desc, path, rootName);
  return renderLeafHelp([rootName, ...path].join(" "), desc);
}

function makeHelpCommand(
  rootName: string,
  subcommands: [AnyCommand, ...AnyCommand[]],
  options?: { readonly description?: string },
) {
  let tempRoot = Command.make(rootName).pipe(
    Command.withSubcommands(subcommands),
  );
  if (options?.description) {
    tempRoot = tempRoot.pipe(Command.withDescription(options.description));
  }
  const rootDesc = (tempRoot as Descriptor).descriptor;

  return Command.make(
    "help",
    { path: Args.text({ name: "command" }).pipe(Args.repeated) },
    ({ path }) => {
      const segments = [...path];
      if (segments.length === 0) {
        return Console.log(renderHelp(rootName, rootDesc, []));
      }

      const result = resolveInDescriptor(rootDesc, segments);
      if (!result || result.kind === "not-found") {
        const available =
          result?.kind === "not-found" && result.available.length > 0
            ? `\n\nAvailable commands: ${result.available.join(", ")}`
            : "";
        return Console.log(
          `Unknown command: ${segments.join(" ")}${available}`,
        );
      }

      return Console.log(renderHelp(rootName, result.desc, segments));
    },
  ).pipe(Command.withDescription("Show help for a command."));
}

export function makeRootCommandGroup(
  name: string,
  subcommands: [AnyCommand, ...AnyCommand[]],
  options?: { readonly description?: string },
) {
  let rootForHelp = Command.make(name).pipe(
    Command.withSubcommands(subcommands),
  );
  if (options?.description) {
    rootForHelp = rootForHelp.pipe(
      Command.withDescription(options.description),
    );
  }
  const rootDesc = (rootForHelp as Descriptor).descriptor;
  const helpCommand = makeHelpCommand(name, subcommands, {
    description: options?.description,
  });
  const allSubcommands: [AnyCommand, ...AnyCommand[]] = [
    ...subcommands,
    helpCommand,
  ];
  let command = Command.make(name, {}, () =>
    Console.log(renderHelp(name, rootDesc, [])),
  ).pipe(Command.withSubcommands(allSubcommands));

  if (options?.description) {
    command = command.pipe(Command.withDescription(options.description));
  }

  return command;
}
