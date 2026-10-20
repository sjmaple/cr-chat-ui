import MlReviewPane from "./MlReviewPane.svelte";
import MlReviewCard from "./MlReviewCard.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { tick } from "svelte";
import { navigation, setPage } from "$lib/components/__tests__/appMocks";
import { mlReviews, type ReviewPayload } from "$lib/stores/mlReview.svelte";
import { sidePane } from "$lib/stores/sidePane.svelte";
import { MessageReviewUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type {
	ReviewDraft,
	ReviewRecord,
	ReviewSchema,
	ReviewSuggestionsMode,
} from "$lib/types/MlReview";

const CONVERSATION = "0123456789abcdef01234567";
const REVIEW = "89abcdef0123456789abcdef";

const labelSchema = (suggestions: ReviewSuggestionsMode = "after_answer"): ReviewSchema => ({
	title: "triage batch 1",
	instructions: "Label each issue.",
	idField: "id",
	fields: [
		{ name: "title", type: "text" },
		{ name: "body", type: "text" },
	],
	questions: [
		{
			name: "kind",
			type: "label",
			required: true,
			options: [{ value: "bug" }, { value: "feature" }, { value: "question" }],
		},
		{ name: "severity", type: "rating", required: false, min: 1, max: 5 },
	],
	suggestions,
});

const RECORDS: ReviewRecord[] = [
	{
		id: "r1",
		values: { title: "Crash on start", body: "The app crashes when I open it on a Pixel." },
		suggestions: { kind: { value: "bug", score: 0.72, rationale: "mentions a crash" } },
	},
	{
		id: "r2",
		values: { title: "Dark mode", body: "Please add a dark theme." },
		suggestions: { kind: { value: "feature" } },
	},
	{ id: "r3", values: { title: "How to export?", body: "Where is the export button?" } },
];

const payload = (overrides: Partial<ReviewPayload> = {}): ReviewPayload => ({
	id: REVIEW,
	schema: labelSchema(),
	schemaHash: "abcd1234",
	records: RECORDS,
	drafts: {},
	status: "open",
	createdAt: new Date(),
	updatedAt: new Date(),
	...overrides,
});

interface Patch {
	index: number;
	draft: Pick<ReviewDraft, "status" | "answers" | "comments">;
	baseRevision?: number;
	keepalive?: boolean;
}

function fakeServer(review: ReviewPayload) {
	const patches: Patch[] = [];
	const submits: unknown[] = [];
	let gate: Promise<void> | undefined;
	let release: (() => void) | undefined;
	let submitAnswer: unknown = { ok: true, files: [] };
	let conflict: ReviewDraft | undefined;
	let onSubmit: (() => void) | undefined;
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (method === "GET" && url.endsWith(`/conversations/${CONVERSATION}/reviews/${REVIEW}`)) {
			return new Response(superjson.stringify(review));
		}
		if (method === "PATCH") {
			const patch: Patch = { ...JSON.parse(String(init?.body)), keepalive: init?.keepalive };
			patches.push(patch);
			if (gate) await gate;
			if (conflict) {
				const draft = conflict;
				conflict = undefined;
				return new Response(
					superjson.stringify({ message: "This record was changed elsewhere.", draft }),
					{ status: 409 }
				);
			}
			return Response.json({ ok: true, problems: [], revision: (patch.baseRevision ?? 0) + 1 });
		}
		if (method === "POST" && url.endsWith("/submit")) {
			submits.push(JSON.parse(String(init?.body)));
			onSubmit?.();
			return Response.json(submitAnswer);
		}
		return new Response("{}", { status: 404 });
	});
	vi.stubGlobal("fetch", fetch);
	return {
		patches,
		submits,
		hold() {
			gate = new Promise((resolve) => (release = resolve));
		},
		release() {
			gate = undefined;
			release?.();
		},
		answerSubmit(body: unknown) {
			submitAnswer = body;
		},
		whenSubmitted(fn: () => void) {
			onSubmit = fn;
		},
		conflictOnce(draft: ReviewDraft) {
			conflict = draft;
		},
	};
}

async function mount(review: ReviewPayload) {
	const server = fakeServer(review);
	setPage({ params: { id: CONVERSATION } });
	sidePane.openReview(REVIEW);
	const screen = render(MlReviewPane);
	await vi.waitFor(() => expect(mlReviews.get(REVIEW)?.load).toBe("ready"));
	await tick();
	return { ...screen, server, session: () => mlReviews.get(REVIEW) };
}

const press = async (key: string, target: EventTarget = document.body) => {
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
	await tick();
};

const position = (container: HTMLElement) =>
	container.querySelector("[data-focus-position]")?.textContent?.trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const question = (container: HTMLElement, name: string) =>
	container.querySelector<HTMLElement>(`[data-question='${name}']`);

const button = (root: ParentNode, label: string) => {
	const found = [...root.querySelectorAll("button")].find(
		// an option of the question the keys answer carries its key hint first
		(candidate) => candidate.textContent?.trim().replace(/^[1-9]\s*/, "") === label
	);
	if (!found) throw new Error(`no button "${label}"`);
	return found;
};

describe("MlReviewPane", () => {
	afterEach(() => {
		try {
			localStorage.removeItem("mlReviewAutoAdvance");
		} catch {
			// storage is optional
		}
		mlReviews.reset();
		sidePane.reset();
		vi.unstubAllGlobals();
	});

	it("labels from the keyboard in the focus view", async () => {
		const { container, server, session } = await mount(payload());
		expect(position(container)).toBe("1 / 3");
		expect(question(container, "kind")?.dataset.active).toBe("true");

		await press("2");
		expect(session()?.draft(0)?.answers.kind).toBe("feature");
		expect(question(container, "severity")?.dataset.active).toBe("true");
		await press("4");
		expect(session()?.draft(0)?.answers).toEqual({ kind: "feature", severity: 4 });
		expect(session()?.draft(0)?.status).toBe("answered");

		await press("j");
		expect(position(container)).toBe("2 / 3");
		await press("1");
		expect(session()?.draft(1)?.answers.kind).toBe("bug");

		await press("k");
		expect(position(container)).toBe("1 / 3");
		await press("Enter");
		expect(position(container)).toBe("3 / 3");

		await press("s");
		expect(session()?.draft(2)?.status).toBe("skipped");

		await press("k");
		await press("c");
		const box = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Comment']");
		expect(box).not.toBeNull();
		await press("3", box as HTMLTextAreaElement);
		expect(session()?.draft(1)?.answers.kind).toBe("bug");

		await vi.waitFor(() =>
			expect(server.patches.find((patch) => patch.index === 0)?.draft).toMatchObject({
				status: "answered",
				answers: { kind: "feature", severity: 4 },
			})
		);
	});

	it("stays editable after the card that loaded it is gone", async () => {
		fakeServer(payload());
		setPage({ params: { id: CONVERSATION } });
		const card = render(MlReviewCard, {
			request: {
				type: MessageUpdateType.Review,
				subtype: MessageReviewUpdateType.Request,
				reviewId: REVIEW,
				toolUuid: "u1",
				title: "triage batch 1",
				records: 3,
				questions: 2,
				mode: "label",
			},
			conversationId: CONVERSATION,
			interactive: true,
		});
		await tick();
		expect(mlReviews.get(REVIEW)?.editable).toBe(false);
		card.unmount();
		await vi.waitFor(() => expect(mlReviews.get(REVIEW)?.load).toBe("ready"));

		sidePane.openReview(REVIEW);
		const { container } = render(MlReviewPane);
		await tick();
		expect(mlReviews.get(REVIEW)?.editable).toBe(true);
		await press("1");
		expect(mlReviews.get(REVIEW)?.draft(0)?.answers.kind).toBe("bug");
		expect(button(container, "Submit review")).toBeTruthy();
	});

	it("shows a review as detached once a turn ends and the server moved it on", async () => {
		const review = payload();
		const { container } = await mount(review);
		review.status = "detached";
		mlReviews.refreshOpen();
		await vi.waitFor(() =>
			expect(container.textContent?.replace(/\s+/g, " ")).toContain(
				"submitting posts the review as your next message"
			)
		);
	});

	it("opens the comment box once per C, not again on the next record", async () => {
		const { container } = await mount(payload());
		await press("c");
		const box = container.querySelector("textarea[aria-label='Comment']") as HTMLTextAreaElement;
		await press("Escape", box);
		expect(container.querySelector("textarea[aria-label='Comment']")).toBeNull();

		await press("j");
		expect(position(container)).toBe("2 / 3");
		expect(container.querySelector("textarea[aria-label='Comment']")).toBeNull();
	});

	it("saves a record once per pause, and at once when the tab is hidden", async () => {
		const { container, server } = await mount(payload());
		const kind = question(container, "kind") as HTMLElement;

		button(kind, "bug").click();
		await tick();
		button(kind, "feature").click();
		await sleep(100);
		expect(server.patches).toHaveLength(0);
		await vi.waitFor(() => expect(server.patches).toHaveLength(1));
		expect(server.patches[0]).toMatchObject({ index: 0, draft: { answers: { kind: "feature" } } });

		button(kind, "question").click();
		await tick();
		Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
		try {
			document.dispatchEvent(new Event("visibilitychange"));
			await vi.waitFor(() => expect(server.patches).toHaveLength(2), { timeout: 150 });
		} finally {
			// the own property shadows the prototype getter, removing it restores the real one
			delete (document as { visibilityState?: unknown }).visibilityState;
		}
		expect(server.patches[1]).toMatchObject({
			keepalive: true,
			draft: { answers: { kind: "question" } },
		});
	});

	it("saves on top of the revision it last saw", async () => {
		const at = new Date();
		const { server } = await mount(
			payload({
				drafts: {
					"0": { status: "pending", answers: {}, comments: [], updatedAt: at, revision: 4 },
				},
			})
		);
		await press("1");
		await vi.waitFor(() => expect(server.patches).toHaveLength(1));
		expect(server.patches[0].baseRevision).toBe(4);

		await press("3");
		await vi.waitFor(() => expect(server.patches).toHaveLength(2));
		expect(server.patches[1].baseRevision).toBe(5);

		await press("j");
		await press("2");
		await vi.waitFor(() => expect(server.patches).toHaveLength(3));
		expect(server.patches[2]).toMatchObject({ index: 1, baseRevision: 0 });
	});

	it("keeps both edits when another tab saved the record first", async () => {
		const at = new Date();
		const { server, session } = await mount(payload());
		server.conflictOnce({
			status: "pending",
			answers: { severity: 2 },
			comments: [{ id: "c-other", body: "from the other tab", createdAt: at }],
			updatedAt: at,
			revision: 7,
		});
		await press("1");
		await vi.waitFor(() => expect(server.patches).toHaveLength(2));
		expect(server.patches[1]).toMatchObject({
			baseRevision: 7,
			draft: { status: "answered", answers: { kind: "bug", severity: 2 } },
		});
		expect(server.patches[1].draft.comments.map((comment) => comment.id)).toEqual(["c-other"]);
		expect(session()?.draft(0)?.answers).toEqual({ kind: "bug", severity: 2 });
		expect(session()?.saveErrors.size).toBe(0);
	});

	it("keeps one save in flight per record, and sends the newest draft after it", async () => {
		const { container, server } = await mount(payload());
		const kind = question(container, "kind") as HTMLElement;

		server.hold();
		button(kind, "bug").click();
		await vi.waitFor(() => expect(server.patches).toHaveLength(1));
		button(kind, "feature").click();
		await tick();
		button(kind, "question").click();
		await sleep(400);
		expect(server.patches).toHaveLength(1);

		server.release();
		await vi.waitFor(() => expect(server.patches).toHaveLength(2));
		expect(server.patches[1].draft.answers).toEqual({ kind: "question" });
		await sleep(400);
		expect(server.patches).toHaveLength(2);
	});

	it("shows why a draft did not save, such as the draft size cap", async () => {
		const { container } = await mount(payload());
		const limit =
			"This review's answers have reached the 8 MB limit. Shorten long answers, or submit this batch and review the rest in another.";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ message: limit }, { status: 413 }))
		);
		await press("1");
		await vi.waitFor(() =>
			expect(container.querySelector("[role='alert']")?.textContent?.trim()).toBe(limit)
		);
		expect(container.textContent).toContain("Not saved");
	});

	it("lists blockers in a drawer that jumps to the record", async () => {
		const { container } = await mount(payload());
		const toggle = () => button(container, `Blockers (${mlReviews.get(REVIEW)?.blockers.length})`);
		expect(toggle().textContent).toContain("Blockers (3)");

		await press("1");
		await tick();
		toggle().click();
		await tick();
		const drawer = container.querySelector("[aria-label='Blockers']") as HTMLElement;
		const entries = [...drawer.querySelectorAll<HTMLButtonElement>("[data-blocker]")];
		expect(entries.map((entry) => entry.dataset.blocker)).toEqual(["1:kind", "2:kind"]);
		expect(entries[1].textContent).toContain("r3");
		expect(entries[1].textContent).toContain("required");

		entries[1].click();
		await tick();
		expect(position(container)).toBe("3 / 3");
		expect(question(container, "kind")?.dataset.active).toBe("true");
		expect(container.querySelector("[aria-label='Blockers']")).toBeNull();

		button(container, "Submit review").click();
		await tick();
		const finish = container.querySelector("[aria-label='Finish your review']") as HTMLElement;
		expect(finish.textContent).toContain("2 blockers left");
		expect(button(finish, "Submit").disabled).toBe(true);
	});

	it("marks a comment whose quote is gone as anchor lost", async () => {
		const at = new Date();
		const { container } = await mount(
			payload({
				drafts: {
					"0": {
						status: "pending",
						answers: {},
						updatedAt: at,
						comments: [
							{
								id: "c-found",
								field: "body",
								quote: { exact: "crashes when I open", prefix: "The app ", suffix: " it on" },
								body: "Which version?",
								createdAt: at,
							},
							{
								id: "c-lost",
								field: "body",
								quote: { exact: "freezes on login", prefix: "", suffix: "" },
								body: "This text changed.",
								createdAt: at,
							},
						],
					},
				},
			})
		);
		const found = container.querySelector("[data-comment='c-found']") as HTMLElement;
		const lost = container.querySelector("[data-comment='c-lost']") as HTMLElement;
		await vi.waitFor(() => expect(lost.textContent).toContain("anchor lost"));
		expect(found.textContent).not.toContain("anchor lost");
		expect(CSS.highlights.get("review-quote")?.size).toBe(1);
	});

	it("comments on a selection, anchored by its quote", async () => {
		const { container, session } = await mount(payload());
		const body = container.querySelector(
			"[data-field='body'] [data-review-quotable]"
		) as HTMLElement;
		const text = body.firstChild as Text;
		const start = text.data.indexOf("crashes");
		const range = document.createRange();
		range.setStart(text, start);
		range.setEnd(text, start + "crashes".length);
		const selection = window.getSelection() as Selection;
		selection.removeAllRanges();
		selection.addRange(range);
		body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		await tick();

		button(container, "Comment on selection").click();
		await vi.waitFor(() =>
			expect(container.querySelector("textarea[aria-label='Comment']")).not.toBeNull()
		);
		const box = container.querySelector("textarea[aria-label='Comment']") as HTMLTextAreaElement;
		box.value = "Which device?";
		box.dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
		button(container, "Add comment").click();
		await tick();

		expect(session()?.draft(0)?.comments[0]).toMatchObject({
			field: "body",
			body: "Which device?",
			quote: { exact: "crashes", prefix: "The app ", suffix: " when I open it on a Pixel." },
		});
	});

	it("takes the selection popup down once the text is deselected", async () => {
		const { container } = await mount(payload());
		const body = container.querySelector(
			"[data-field='body'] [data-review-quotable]"
		) as HTMLElement;
		const range = document.createRange();
		range.setStart(body.firstChild as Text, 4);
		range.setEnd(body.firstChild as Text, 7);
		const selection = window.getSelection() as Selection;
		selection.removeAllRanges();
		selection.addRange(range);
		body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		await tick();
		expect(container.querySelector("[data-selection-popup]")).not.toBeNull();

		selection.removeAllRanges();
		await vi.waitFor(() => expect(container.querySelector("[data-selection-popup]")).toBeNull());
	});

	it("starts a long review with its instructions collapsed and remembers the toggle", async () => {
		const many = Array.from({ length: 30 }, (_, i) => ({
			id: `r${i + 1}`,
			values: { title: `issue ${i + 1}`, body: "text" },
		}));
		const { container, session } = await mount(payload({ records: many }));
		expect(container.textContent).not.toContain("Label each issue.");

		button(container, "Instructions").click();
		await tick();
		expect(container.textContent).toContain("Label each issue.");
		expect(session()?.instructionsOpen).toBe(true);
	});

	it("keeps the record nav and the questions in view while a long record scrolls", async () => {
		const { container } = await mount(payload());
		const dock = container.querySelector("[data-question-dock]") as HTMLElement;
		expect(dock.querySelector("[data-question='kind']")).not.toBeNull();
		expect(getComputedStyle(dock).position).toBe("sticky");
		const nav = container.querySelector("[data-focus-position]")?.closest(".sticky");
		expect(nav && getComputedStyle(nav).position).toBe("sticky");
		expect(container.querySelector("[data-record] [data-question]")).toBeNull();
	});

	it("auto-advances once every pickable question of the record is answered", async () => {
		const { container } = await mount(payload());
		const toggle = container.querySelector(
			"[data-question-dock] input[type='checkbox']"
		) as HTMLInputElement;
		toggle.click();
		await tick();

		await press("1");
		await sleep(400);
		expect(position(container)).toBe("1 / 3");

		await press("3");
		await vi.waitFor(() => expect(position(container)).toBe("2 / 3"));
	});

	it("hides a golden set's suggestions until the question is answered", async () => {
		const { container } = await mount(payload());
		expect(question(container, "kind")?.querySelector("[data-suggestion]")).toBeNull();
		await press("a");
		expect(mlReviews.get(REVIEW)?.draft(0)).toBeUndefined();

		await press("1");
		const chip = question(container, "kind")?.querySelector("[data-suggestion]");
		expect(chip?.textContent).toContain("model: bug · 0.72");
		expect(chip?.textContent).toContain("agrees");
	});

	it("shows a review's suggestions from the start, never pre-selected, and A accepts one", async () => {
		const { container, session } = await mount(payload({ schema: labelSchema("shown") }));
		const kind = question(container, "kind") as HTMLElement;
		expect(kind.querySelector("[data-suggestion]")?.getAttribute("title")).toBe("mentions a crash");
		expect(kind.querySelector("[aria-checked='true']")).toBeNull();

		await press("a");
		expect(session()?.draft(0)?.answers.kind).toBe("bug");
	});

	async function submitAll(container: HTMLElement) {
		for (let i = 0; i < RECORDS.length; i += 1) {
			await press("1");
			await press("j");
		}
		button(container, "Submit review").click();
		await tick();
		const finish = container.querySelector("[aria-label='Finish your review']") as HTMLElement;
		button(finish, "Submit").click();
	}

	it("submits after the drafts are saved, and follows the message the server posted", async () => {
		const review = payload({ status: "detached" });
		const { container, server } = await mount(review);
		server.answerSubmit({ ok: true, files: [], delivery: "sent" });
		server.whenSubmitted(() => {
			review.status = "submitted";
			review.verdict = "approve";
			review.delivery = { status: "sent", messageId: "m-1" };
		});

		await submitAll(container);
		await vi.waitFor(() => expect(navigation.invalidate).toHaveBeenCalledWith("conversation:id"), {
			timeout: 5_000,
		});
		expect(server.patches.map((patch) => patch.index).sort()).toEqual([0, 1, 2]);
		expect(server.submits[0]).toMatchObject({ verdict: "approve" });
		await vi.waitFor(() =>
			expect(container.querySelector("[data-delivery='sent']")?.textContent).toContain(
				"Posted as your message"
			)
		);
	});

	it("waits for a queued submission to be posted before following it", async () => {
		const review = payload({ status: "detached" });
		const { container, server } = await mount(review);
		server.answerSubmit({ ok: true, files: [], delivery: "queued" });
		server.whenSubmitted(() => {
			review.status = "submitted";
			review.verdict = "approve";
			review.delivery = { status: "pending" };
		});

		await submitAll(container);
		await vi.waitFor(
			() => expect(container.querySelector("[data-delivery='pending']")).not.toBeNull(),
			{
				timeout: 5_000,
			}
		);
		expect(navigation.invalidate).not.toHaveBeenCalled();

		review.delivery = { status: "sent", messageId: "m-2" };
		await vi.waitFor(() => expect(navigation.invalidate).toHaveBeenCalledWith("conversation:id"), {
			timeout: 6_000,
		});
	});
});
