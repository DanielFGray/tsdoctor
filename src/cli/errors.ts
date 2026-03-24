import { Schema } from "effect"

export class ServerStartError extends Schema.TaggedErrorClass(
  "ServerStartError",
)("ServerStartError", {
  message: Schema.String,
}) {}

export class ServerConnectError extends Schema.TaggedErrorClass(
  "ServerConnectError",
)("ServerConnectError", {
  url: Schema.String,
}) {}

export class MissingArgumentError extends Schema.TaggedErrorClass(
  "MissingArgumentError",
)("MissingArgumentError", {
  command: Schema.String,
  argument: Schema.String,
}) {}

export class UnknownCommandError extends Schema.TaggedErrorClass(
  "UnknownCommandError",
)("UnknownCommandError", {
  command: Schema.String,
}) {}
