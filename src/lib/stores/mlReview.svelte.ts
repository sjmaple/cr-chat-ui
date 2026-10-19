import { base } from "$app/paths";
import superjson from "superjson";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { pendingComposerPayload } from "$lib/stores/pendingComposerPayload";
import type { MlFileRef } from "$lib/types/MlFile";
import type {
	ReviewAnswer,
	ReviewComment,
	ReviewDraft,
	ReviewQuote,
	ReviewRecord,
	ReviewSchema,
	ReviewStatus,
	ReviewVerdict,
} from "$lib/types/MlReview";
import { blockers, type ReviewBlocker } from "$lib/utils/review/answers";
import { draftStatus } from "$lib/utils/review/view";
import { mcpSelection } from "$lib/utils/sendElicitationAnswer";

export const REVIEW_SAVE_DEBOUNCE_MS = 250;

type FetchFn = typeof globalThis.fetch;

export interface ReviewPayload {
	id: string;
	schema: ReviewSchema;
	schemaHash: string;
	records: ReviewRecord[];
	drafts: Record<string, ReviewDraft>;
	status: ReviewStatus;
	verdict?: ReviewVerdict;
	summary?: string;
	result?: { text: string; files: MlFileRef[] };
	createdAt: Date;
	updatedAt: Date;
}

export type ReviewLoad = "loading" | "ready" | "missing" | "error";

export interface ReviewCounts {
	answered: number;
	skipped: number;
	comments: number;
}

export interface CommentInput {
	field?: string;
	quote?: ReviewQuote;
	body: string;
}

const UNREACHABLE = "Could not reach the server. Try again.";

const messageOf = (body: unknown, fallback: string): string =>
	typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
		? body.message
		: fallback;

const emptyDraft = (): ReviewDraft => ({
	status: "pending",
	answers: {},
	comments: [],
	updatedAt: new Date(),
});

/** saves per record, debounced, one request in flight, the newest draft wins */
export class ReviewSession {
	readonly conversationId: string;
	readonly reviewId: string;

	load = $state<ReviewLoad>("loading");
	payload = $state.raw<ReviewPayload | undefined>(undefined);
	drafts = $state<Record<string, ReviewDraft>>({});
	/** by record position, why its last save failed */
	saveErrors = new SvelteMap<number, string>();
	saving = $state(0);
	verdict = $state<ReviewVerdict | undefined>(undefined);
	summary = $state("");
	submitting = $state(false);
	submitError = $state<string | undefined>(undefined);
	/** the blockers a refused submit answered with */
	serverBlockers = $state.raw<ReviewBlocker[]>([]);

	/** pane state, kept here so a closed and reopened pane lands where the user was */
	view = $state<"list" | "focus" | undefined>(undefined);
	focus = $state(0);
	expanded = new SvelteSet<number>();

	schema = $derived(this.payload?.schema);
	records = $derived(this.payload?.records ?? []);
	editable = $derived(
		this.load === "ready" &&
			(this.payload?.status === "open" || this.payload?.status === "detached")
	);
	blockers = $derived(
		this.payload ? blockers(this.payload.schema, this.drafts, this.payload.records.length) : []
	);
	counts = $derived.by((): ReviewCounts => {
		const counts = { answered: 0, skipped: 0, comments: 0 };
		for (const draft of Object.values(this.drafts)) {
			if (draft.status === "answered") counts.answered += 1;
			if (draft.status === "skipped" || draft.status === "discarded") counts.skipped += 1;
			counts.comments += draft.comments.length;
		}
		return counts;
	});
	/** label mode, some question is required on every record */
	labelling = $derived(
		this.payload?.schema.questions.some((question) => question.required) ?? false
	);
	chosenVerdict = $derived<ReviewVerdict>(
		this.verdict ?? (this.labelling || this.counts.comments === 0 ? "approve" : "comment")
	);

	#timers = new Map<number, ReturnType<typeof setTimeout>>();
	#inflight = new Map<number, Promise<void>>();
	#again = new Set<number>();
	readonly #owner: MlReviewsStore;
	readonly #epoch: number;

	constructor(owner: MlReviewsStore, conversationId: string, reviewId: string, epoch: number) {
		this.#owner = owner;
		this.conversationId = conversationId;
		this.reviewId = reviewId;
		this.#epoch = epoch;
	}

	get #url() {
		return `${base}/api/v2/conversations/${this.conversationId}/reviews/${encodeURIComponent(this.reviewId)}`;
	}

	/** false once the store moved to another conversation, a late answer then lands nowhere */
	get #alive() {
		return this.#owner.epoch === this.#epoch;
	}

	draft(index: number): ReviewDraft | undefined {
		return this.drafts[String(index)];
	}

	async refresh(): Promise<void> {
		try {
			const res = await this.#owner.fetcher(this.#url, { headers: { Accept: "application/json" } });
			if (!this.#alive) return;
			if (res.status === 404) {
				this.load = "missing";
				return;
			}
			if (!res.ok) {
				if (!this.payload) this.load = "error";
				return;
			}
			const payload = superjson.parse<ReviewPayload>(await res.text());
			if (!this.#alive) return;
			const drafts: Record<string, ReviewDraft> = { ...payload.drafts };
			// an edit still waiting to be saved is newer than what the server holds
			for (const index of [...this.#timers.keys(), ...this.#inflight.keys()]) {
				const local = this.drafts[String(index)];
				if (local) drafts[String(index)] = local;
			}
			this.drafts = drafts;
			this.payload = payload;
			if (payload.verdict) this.verdict = payload.verdict;
			if (payload.summary !== undefined) this.summary = payload.summary;
			this.load = "ready";
		} catch {
			if (this.#alive && !this.payload) this.load = "error";
		}
	}

	setAnswer(index: number, question: string, value: ReviewAnswer | undefined): void {
		const schema = this.schema;
		if (!schema || !this.editable) return;
		const current = this.draft(index) ?? emptyDraft();
		const answers = { ...current.answers };
		if (value === undefined) delete answers[question];
		else answers[question] = value;
		this.#update(index, {
			...current,
			answers,
			status: draftStatus(schema, answers, current.status, { answering: true }),
		});
	}

	skip(index: number): void {
		if (!this.editable) return;
		const current = this.draft(index) ?? emptyDraft();
		this.#update(index, { ...current, status: "skipped" });
	}

	addComment(index: number, input: CommentInput): ReviewComment | undefined {
		if (!this.editable) return undefined;
		const current = this.draft(index) ?? emptyDraft();
		const comment: ReviewComment = {
			id: globalThis.crypto.randomUUID(),
			...(input.field !== undefined ? { field: input.field } : {}),
			...(input.quote ? { quote: input.quote } : {}),
			body: input.body.trim(),
			createdAt: new Date(),
		};
		this.#update(index, { ...current, comments: [...current.comments, comment] });
		return comment;
	}

	removeComment(index: number, id: string): void {
		const current = this.draft(index);
		if (!current || !this.editable) return;
		this.#update(index, {
			...current,
			comments: current.comments.filter((comment) => comment.id !== id),
		});
	}

	#update(index: number, next: ReviewDraft) {
		this.drafts[String(index)] = { ...next, updatedAt: new Date() };
		const timer = this.#timers.get(index);
		if (timer) clearTimeout(timer);
		this.#timers.set(
			index,
			setTimeout(() => void this.#save(index), REVIEW_SAVE_DEBOUNCE_MS)
		);
	}

	/** keepalive lets the requests outlive a closing tab */
	async flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
		const waiting = [...this.#timers.keys()].map((index) => this.#save(index, keepalive));
		await Promise.all([...waiting, ...this.#inflight.values()]);
	}

	#save(index: number, keepalive = false): Promise<void> {
		const timer = this.#timers.get(index);
		if (timer) clearTimeout(timer);
		this.#timers.delete(index);
		const running = this.#inflight.get(index);
		if (running) {
			this.#again.add(index);
			return running;
		}
		const request = (async () => {
			try {
				await this.#send(index, keepalive);
			} finally {
				this.#inflight.delete(index);
			}
			// the edit made while the last one was in flight, sent even after a conversation switch
			if (this.#again.delete(index)) await this.#save(index, keepalive);
		})();
		this.#inflight.set(index, request);
		return request;
	}

	async #send(index: number, keepalive: boolean): Promise<void> {
		const draft = this.draft(index);
		if (!draft) return;
		const body = JSON.stringify({
			index,
			draft: {
				status: draft.status,
				answers: $state.snapshot(draft.answers),
				comments: $state.snapshot(draft.comments),
			},
		});
		this.saving += 1;
		try {
			const res = await this.#owner.fetcher(this.#url, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body,
				keepalive,
			});
			if (!this.#alive) return;
			if (res.ok) {
				this.saveErrors.delete(index);
				return;
			}
			const parsed = await res.json().catch(() => null);
			this.saveErrors.set(index, messageOf(parsed, "This draft did not save."));
			// submitted from another tab or expired, show what the server holds
			if (res.status === 409) void this.refresh();
		} catch {
			if (this.#alive) this.saveErrors.set(index, UNREACHABLE);
		} finally {
			this.saving -= 1;
		}
	}

	async submit(verdict: ReviewVerdict): Promise<boolean> {
		if (this.submitting || !this.editable) return false;
		this.submitting = true;
		this.submitError = undefined;
		this.serverBlockers = [];
		try {
			await this.flush();
			if (!this.#alive) return false;
			if (this.saveErrors.size > 0) {
				this.submitError = "Some drafts did not save, so the review was not submitted.";
				return false;
			}
			const selection = await mcpSelection();
			const summary = this.summary.trim();
			const res = await this.#owner.fetcher(`${this.#url}/submit`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ verdict, ...(summary ? { summary } : {}), selection }),
			});
			const body = await res.json().catch(() => null);
			if (!this.#alive) return false;
			if (!res.ok) {
				this.submitError = messageOf(body, "Could not submit the review.");
				if (res.status === 400 && Array.isArray(body?.blockers))
					this.serverBlockers = body.blockers;
				if (res.status === 409) void this.refresh();
				return false;
			}
			this.verdict = verdict;
			if (body?.deliverAsMessage && typeof body.text === "string") this.#owner.deliver(body.text);
			await this.refresh();
			return true;
		} catch {
			if (this.#alive) this.submitError = UNREACHABLE;
			return false;
		} finally {
			this.submitting = false;
		}
	}
}

/** the reviews of the open conversation, a review is loaded when its card or pane first needs it */
export class MlReviewsStore {
	conversationId = $state<string | undefined>(undefined);
	/** bumped by every reset, a session from before one is dead */
	epoch = 0;
	#sessions = new SvelteMap<string, ReviewSession>();
	#disposers: (() => void)[] = [];
	#deliver: ((text: string) => boolean) | undefined;
	readonly #fetcher: FetchFn | undefined;

	/** the fetch is injectable so a spec never opens a socket */
	constructor(fetcher?: FetchFn) {
		this.#fetcher = fetcher;
	}

	get fetcher(): FetchFn {
		return this.#fetcher ?? globalThis.fetch;
	}

	get(reviewId: string | null | undefined): ReviewSession | undefined {
		return reviewId ? this.#sessions.get(reviewId) : undefined;
	}

	ensure(conversationId: string, reviewId: string): ReviewSession {
		this.bind(conversationId);
		const existing = this.#sessions.get(reviewId);
		if (existing) return existing;
		// created under the card effect, the session deriveds would freeze when the card remounts
		let session: ReviewSession | undefined;
		this.#disposers.push(
			$effect.root(() => {
				session = new ReviewSession(this, conversationId, reviewId, this.epoch);
			})
		);
		if (!session) throw new Error("review session was not created");
		this.#sessions.set(reviewId, session);
		void session.refresh();
		return session;
	}

	bind(conversationId: string | undefined): void {
		if (this.conversationId === conversationId) return;
		this.reset();
		this.conversationId = conversationId;
	}

	/** a turn that ended may have detached or expired a review this tab still shows as open */
	refreshOpen(): void {
		for (const session of this.#sessions.values()) {
			if (session.payload?.status === "open") void session.refresh();
		}
	}

	flushAll(options?: { keepalive?: boolean }): Promise<void> {
		return Promise.all([...this.#sessions.values()].map((session) => session.flush(options))).then(
			() => undefined
		);
	}

	reset(): void {
		void this.flushAll({ keepalive: true });
		this.epoch += 1;
		this.#sessions.clear();
		for (const dispose of this.#disposers.splice(0)) dispose();
		this.conversationId = undefined;
	}

	/** the chat send path, for a review whose turn already moved on */
	setDeliver(deliver: (text: string) => boolean): () => void {
		this.#deliver = deliver;
		return () => {
			if (this.#deliver === deliver) this.#deliver = undefined;
		};
	}

	deliver(text: string): void {
		if (this.#deliver?.(text)) return;
		// a turn is running, so the submission waits in the composer
		pendingComposerPayload.set({ text });
	}
}

export const mlReviews = new MlReviewsStore();
