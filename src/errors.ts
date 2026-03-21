import { Schema } from "effect"

export class ProgramCreateError extends Schema.TaggedErrorClass(
  "ProgramCreateError",
)("ProgramCreateError", {
  file: Schema.String,
}) {}

export class FileNotInProgramError extends Schema.TaggedErrorClass(
  "FileNotInProgramError",
)("FileNotInProgramError", {
  file: Schema.String,
}) {}

export class NodeNotFoundError extends Schema.TaggedErrorClass(
  "NodeNotFoundError",
)("NodeNotFoundError", {
  file: Schema.String,
  line: Schema.Number,
  col: Schema.Number,
}) {}

export class PositionOutOfRangeError extends Schema.TaggedErrorClass(
  "PositionOutOfRangeError",
)("PositionOutOfRangeError", {
  file: Schema.String,
  line: Schema.Number,
  col: Schema.Number,
}) {}

export type IntrospectionError =
  | ProgramCreateError
  | FileNotInProgramError
  | NodeNotFoundError
  | PositionOutOfRangeError
