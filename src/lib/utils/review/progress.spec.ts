import { describe, expect, it } from "vitest";
import type { ReviewRecord, ReviewSchema } from "$lib/types/MlReview";
import {
	headingField,
	isTabular,
	keyRange,
	modelDisagrees,
	plainText,
	progressRuns,
	recordState,
} from "./progress";

const schema = (fields: ReviewSchema["fields"]): Pick<ReviewSchema, "fields" | "idField"> => ({
	fields,
	idField: "id",
});
const record = (values: Record<string, unknown>, suggestions?: ReviewRecord["suggestions"]) => ({
	id: "r",
	values,
	...(suggestions ? { suggestions } : {}),
});

it("merges neighbouring records in the same state into runs", () => {
	expect(progressRuns(["answered", "answered", "skipped", "todo", "todo", "answered"])).toEqual([
		{ state: "answered", count: 2 },
		{ state: "skipped", count: 1 },
		{ state: "todo", count: 2 },
		{ state: "answered", count: 1 },
	]);
	expect(recordState({ status: "discarded" })).toBe("skipped");
	expect(recordState(undefined)).toBe("todo");
});

describe("headingField", () => {
	it("takes the first short text field, never the id", () => {
		const fields: ReviewSchema["fields"] = [
			{ name: "id", type: "text" },
			{ name: "body", type: "markdown" },
			{ name: "title", type: "text" },
		];
		expect(
			headingField(schema(fields), [record({ id: "1", title: "Crash", body: "long" })])?.name
		).toBe("title");
	});

	it("skips a text field too long to be a title", () => {
		const fields: ReviewSchema["fields"] = [{ name: "text", type: "text" }];
		expect(headingField(schema(fields), [record({ text: "x".repeat(400) })])).toBeUndefined();
	});
});

it("previews markdown and JSON as plain words, keeping snake_case", () => {
	expect(
		plainText("### Steps\n\n1. Set `OPENAI_BASE_URL`\n2. **Run** it, see [docs](https://x)")
	).toBe("Steps Set OPENAI_BASE_URL Run it, see docs");
	expect(plainText({ tokens: 4 })).toBe('{"tokens":4}');
	expect(
		plainText([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
		])
	).toBe("hi hello");
});

it("calls rows tabular only when every field is short and typed", () => {
	const short: ReviewSchema["fields"] = [
		{ name: "utterance", type: "text" },
		{ name: "intent", type: "category" },
	];
	expect(isTabular(schema(short), [record({ utterance: "refund", intent: "billing" })])).toBe(true);
	expect(isTabular(schema([...short, { name: "body", type: "markdown" }]), [])).toBe(false);
});

it("names the keys a question answers to", () => {
	expect(
		keyRange({
			name: "k",
			type: "label",
			required: true,
			options: [{ value: "a" }, { value: "b" }],
		})
	).toBe("1–2");
	expect(keyRange({ name: "s", type: "rating", required: false, min: 0, max: 10 })).toBe("1–9");
	expect(keyRange({ name: "t", type: "text", required: false, maxLength: 10 })).toBeUndefined();
});

it("finds where the user answered differently from the model", () => {
	const questions: ReviewSchema["questions"] = [
		{
			name: "kind",
			type: "label",
			required: true,
			options: [{ value: "bug" }, { value: "feature" }],
		},
	];
	const guessed = record({}, { kind: { value: "bug" } });
	const draft = (kind: string) => ({
		status: "answered" as const,
		answers: { kind },
		comments: [],
		updatedAt: new Date(),
	});
	expect(modelDisagrees({ questions }, guessed, draft("feature"))).toBe(true);
	expect(modelDisagrees({ questions }, guessed, draft("bug"))).toBe(false);
	expect(modelDisagrees({ questions }, guessed, undefined)).toBe(false);
});
