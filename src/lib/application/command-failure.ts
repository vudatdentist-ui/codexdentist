import { ApplicationCommandError } from "./errors";
export function failCommand(code: string): never { throw new ApplicationCommandError(code); }
