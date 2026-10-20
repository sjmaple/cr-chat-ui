<script lang="ts">
	import { tick } from "svelte";
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import { passFailQuestion, shownFields } from "$lib/utils/review/progress";
	import ProgressBar, { type BarState } from "./ProgressBar.svelte";
	import QuestionRow from "./QuestionRow.svelte";
	import RecordBody from "./RecordBody.svelte";

	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonClose from "~icons/carbon/close";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonChevronUp from "~icons/carbon/chevron-up";
	import CarbonChevronDown from "~icons/carbon/chevron-down";

	interface Props {
		session: ReviewSession;
	}

	let { session }: Props = $props();

	type Filter = "all" | "todo" | "wrong" | "commented";
	const EXTRA_COLUMNS = 4;

	let schema = $derived(session.schema);
	let records = $derived(session.records);
	let fields = $derived(schema ? shownFields(schema) : []);
	let lead = $derived(fields[0]);
	let extra = $derived(fields.slice(1, 1 + EXTRA_COLUMNS));
	let check = $derived(schema ? passFailQuestion(schema) : undefined);
	let selected = $state<number | undefined>(undefined);
	let filter = $state<Filter>("all");
	let tableEl: HTMLElement | undefined = $state();

	const answerOf = (index: number) =>
		check ? session.draft(index)?.answers[check.name] : undefined;

	let states = $derived<BarState[]>(
		records.map((_, index) => {
			if (check) {
				const value = answerOf(index);
				return value === true ? "pass" : value === false ? "fail" : "todo";
			}
			const state = session.states[index];
			return state;
		})
	);

	let counts = $derived({
		all: records.length,
		todo: states.filter((state) => state === "todo").length,
		wrong: states.filter((state) => state === "fail").length,
		commented: records.filter((_, index) => (session.draft(index)?.comments.length ?? 0) > 0)
			.length,
		pass: states.filter((state) => state === "pass" || state === "answered").length,
	});

	let commentedSet = $derived(
		new Set(
			records.flatMap((_, index) =>
				(session.draft(index)?.comments.length ?? 0) > 0 ? [index] : []
			)
		)
	);

	let shown = $derived(
		records
			.map((record, index) => ({ record, index }))
			.filter(({ index }) => {
				if (filter === "todo") return states[index] === "todo";
				if (filter === "wrong") return states[index] === "fail";
				if (filter === "commented") return commentedSet.has(index);
				return true;
			})
	);

	function mark(index: number, value: boolean) {
		if (!check) return;
		session.setAnswer(index, check.name, answerOf(index) === value ? undefined : value);
	}

	async function select(index: number | undefined) {
		selected = index;
		if (index === undefined) return;
		await tick();
		tableEl?.querySelector(`[data-table-row="${index}"]`)?.scrollIntoView({ block: "nearest" });
	}

	const cell = (value: unknown) => (value === undefined || value === null ? "—" : String(value));
	const columns = $derived(
		`44px minmax(0,1fr) ${extra.map(() => "112px").join(" ")} ${check ? "84px" : ""}`.trim()
	);

	const filters: [Filter, string][] = [
		["all", "All"],
		["todo", "Not checked"],
		["wrong", "Wrong"],
		["commented", "Commented"],
	];
</script>

<div
	class="flex flex-none items-center gap-2 border-b border-gray-200 py-2.5 pr-3 pl-4 dark:border-gray-800"
>
	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
		{#each filters.filter(([key]) => key !== "wrong" || check) as [key, label] (key)}
			<button
				type="button"
				class={[
					"inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium whitespace-nowrap",
					filter === key
						? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
						: "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300",
				]}
				aria-pressed={filter === key}
				data-filter={key}
				onclick={() => (filter = key)}
			>
				{label}
				<span class={filter === key ? "opacity-70" : "text-gray-500 dark:text-gray-400"}
					>{counts[key]}</span
				>
			</button>
		{/each}
	</div>
</div>

<div
	class="flex flex-none items-center gap-3.5 border-b border-gray-200 px-4 py-1 dark:border-gray-800"
>
	<ProgressBar
		{states}
		current={selected}
		commented={commentedSet}
		label="{counts.pass} {check
			? 'correct'
			: 'answered'}, {counts.wrong} wrong, {counts.todo} to check. Click to jump."
		onseek={(index) => select(index)}
	/>
	<span
		class="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
	>
		<span class="size-2 rounded-[2px] bg-green-600 dark:bg-green-500"></span>{counts.pass}
		{check ? "correct" : "answered"}
	</span>
	{#if check}
		<span
			class="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
		>
			<span class="size-2 rounded-[2px] bg-red-700 dark:bg-red-500"></span>{counts.wrong} wrong
		</span>
	{/if}
	<span
		class="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
	>
		<span
			class="size-2 rounded-[2px] bg-gray-100 ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700"
		></span>{counts.todo}
		to check
	</span>
</div>

<div class="flex min-h-0 flex-1">
	<div
		bind:this={tableEl}
		class="scrollbar-custom min-w-0 flex-1 overflow-auto"
		role="table"
		aria-label="Rows"
		data-table-view
	>
		<div
			class="sticky top-0 z-[1] grid h-9 items-center gap-x-3 border-b border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400"
			style="grid-template-columns: {columns}"
			role="row"
		>
			<span class="text-right" role="columnheader">#</span>
			<span role="columnheader">{lead?.title ?? lead?.name}</span>
			{#each extra as field (field.name)}
				<span class="truncate" role="columnheader">{field.title ?? field.name}</span>
			{/each}
			{#if check}
				<span class="text-gray-900 dark:text-gray-100" role="columnheader"
					>{check.title ?? check.name}</span
				>
			{/if}
		</div>
		{#each shown as { record, index } (index)}
			{@const value = answerOf(index)}
			<div
				class={[
					"grid h-[52px] cursor-pointer items-center gap-x-3 border-b border-gray-200 px-3 text-[13.5px] dark:border-gray-800",
					selected === index
						? "bg-blue-50 dark:bg-blue-400/[0.14]"
						: "hover:bg-gray-50 dark:hover:bg-gray-800/40",
				]}
				style="grid-template-columns: {columns}"
				role="row"
				tabindex="0"
				data-table-row={index}
				onclick={() => select(index)}
				onkeydown={(e) => e.key === "Enter" && select(index)}
			>
				<span class="text-right font-mono text-xs text-gray-500 dark:text-gray-400"
					>{index + 1}</span
				>
				<span class="line-clamp-2 leading-[1.4] text-gray-900 dark:text-gray-100">
					{lead ? cell(record.values[lead.name]) : record.id}
				</span>
				{#each extra as field (field.name)}
					<span class="relative justify-self-start">
						<span
							class={field.type === "category"
								? "rounded-[5px] bg-gray-100 px-[7px] py-[3px] text-xs font-medium whitespace-nowrap text-gray-700 dark:bg-gray-800 dark:text-gray-300"
								: field.type === "number"
									? "font-mono text-[12.5px] text-gray-700 dark:text-gray-300"
									: "line-clamp-2 text-[12.5px] text-gray-500 dark:text-gray-400"}
						>
							{cell(record.values[field.name])}
						</span>
					</span>
				{/each}
				{#if check}
					<span class="flex gap-1">
						<button
							type="button"
							class={[
								"inline-flex h-7 w-[34px] items-center justify-center rounded-[7px] border",
								value === true
									? "border-transparent bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400"
									: "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400",
							]}
							aria-label="Correct"
							aria-pressed={value === true}
							disabled={!session.editable}
							onclick={(e) => {
								e.stopPropagation();
								mark(index, true);
							}}
						>
							<CarbonCheckmark />
						</button>
						<button
							type="button"
							class={[
								"inline-flex h-7 w-[34px] items-center justify-center rounded-[7px] border",
								value === false
									? "border-transparent bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-400"
									: "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400",
							]}
							aria-label="Wrong"
							aria-pressed={value === false}
							disabled={!session.editable}
							onclick={(e) => {
								e.stopPropagation();
								mark(index, false);
							}}
						>
							<CarbonClose />
						</button>
					</span>
				{/if}
			</div>
		{/each}
	</div>

	{#if selected !== undefined && records[selected]}
		{@const index = selected}
		<aside
			aria-label="Row {index + 1}"
			class="flex w-[340px] flex-none flex-col border-l border-gray-200 dark:border-gray-800"
			data-row-detail
		>
			<div
				class="flex h-11 flex-none items-center gap-1 border-b border-gray-200 pr-1.5 pl-4 dark:border-gray-800"
			>
				<span class="flex-1 text-[13px] font-semibold text-gray-900 dark:text-gray-100"
					>Row {index + 1}</span
				>
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
					aria-label="Previous row"
					disabled={index === 0}
					onclick={() => select(index - 1)}
				>
					<CarbonChevronUp />
				</button>
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
					aria-label="Next row"
					disabled={index >= records.length - 1}
					onclick={() => select(index + 1)}
				>
					<CarbonChevronDown />
				</button>
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
					aria-label="Close row"
					onclick={() => (selected = undefined)}
				>
					<CarbonCloseLarge />
				</button>
			</div>
			<div class="scrollbar-custom flex flex-1 flex-col gap-4 overflow-y-auto">
				<div class="px-4 pt-4">
					<RecordBody {session} {index} />
				</div>
				{#if (schema?.questions.length ?? 0) > 0}
					<div class="border-t border-gray-200 dark:border-gray-800">
						{#each schema?.questions ?? [] as question (question.name)}
							<QuestionRow
								{question}
								value={session.draft(index)?.answers[question.name]}
								suggestion={records[index]?.suggestions?.[question.name]}
								mode={schema?.suggestions ?? "none"}
								disabled={!session.editable}
								layout="stack"
								onchange={(answer) => session.setAnswer(index, question.name, answer)}
							/>
						{/each}
					</div>
				{/if}
			</div>
		</aside>
	{/if}
</div>
