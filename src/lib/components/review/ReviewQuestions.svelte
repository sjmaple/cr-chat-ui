<script lang="ts">
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import type { ReviewQuestion } from "$lib/types/MlReview";
	import QuestionInput from "./fields/QuestionInput.svelte";

	interface Props {
		session: ReviewSession;
		index: number;
		questions: ReviewQuestion[];
		/** the question the number keys answer, focus view only */
		activeQuestion?: string;
		onactivequestion?: (name: string) => void;
		onanswer?: (question: ReviewQuestion) => void;
		/** names the field a targeted question is about, once it no longer sits under it */
		showTarget?: boolean;
	}

	let {
		session,
		index,
		questions,
		activeQuestion,
		onactivequestion,
		onanswer,
		showTarget = false,
	}: Props = $props();

	let schema = $derived(session.schema);
	let record = $derived(session.records[index]);
	let draft = $derived(session.draft(index));

	const fieldTitle = (name: string) => {
		const field = schema?.fields.find((candidate) => candidate.name === name);
		return field?.title ?? name;
	};
</script>

{#each questions as question (question.name)}
	<div class="flex flex-col gap-0.5">
		{#if showTarget && question.target}
			<span class="text-[11px] text-gray-400 dark:text-gray-500">
				on {fieldTitle(question.target)}
			</span>
		{/if}
		<QuestionInput
			{question}
			value={draft?.answers[question.name]}
			suggestion={record?.suggestions?.[question.name]}
			mode={schema?.suggestions ?? "none"}
			active={activeQuestion === question.name}
			disabled={!session.editable}
			onchange={(value) => {
				session.setAnswer(index, question.name, value);
				onanswer?.(question);
			}}
			onactivate={() => onactivequestion?.(question.name)}
		/>
	</div>
{/each}
