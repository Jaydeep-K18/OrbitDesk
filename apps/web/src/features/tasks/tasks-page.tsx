import { useState, type FormEvent } from 'react';
import { ListTodo, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Task } from '@focusguard/contracts';
import { useTaskMutations, useTasks } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { TASK_CATEGORIES } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';

const categoryLabel = (c: string) => TASK_CATEGORIES.find((x) => x.value === c)?.label ?? c;

function TaskRow({ task }: { task: Task }) {
  const { update, remove } = useTaskMutations();
  const done = task.status === 'done';
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <input
        type="checkbox"
        aria-label={`Mark "${task.title}" ${done ? 'not done' : 'done'}`}
        checked={done}
        onChange={(e) => update.mutate({ id: task.id, status: e.target.checked ? 'done' : 'todo' })}
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate ${done ? 'text-muted-foreground line-through' : ''}`}>
          {task.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {categoryLabel(task.category)}
          {task.estimateMin ? ` · ~${task.estimateMin} min` : ''}
          {task.dueDate ? ` · due ${task.dueDate}` : ''}
        </p>
      </div>
      {task.status === 'in_progress' ? (
        <Badge className="bg-accent text-accent-foreground">In progress</Badge>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete "${task.title}"`}
        onClick={() => remove.mutate(task.id, { onSuccess: () => toast('Task deleted') })}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

export function TasksPage() {
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const { data, isLoading, error, refetch } = useTasks();
  const { create } = useTaskMutations();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('coding_practice');
  const [estimate, setEstimate] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setTitleError(null);
    try {
      await create.mutateAsync({
        title,
        category,
        ...(estimate ? { estimateMin: Number(estimate) } : {}),
      });
      setTitle('');
      setEstimate('');
    } catch (err) {
      setTitleError(
        err instanceof ApiError ? (err.fieldErrors().title ?? err.message) : 'Could not add task',
      );
    }
  };

  const items = (data?.items ?? []).filter((t) =>
    filter === 'all' ? true : filter === 'done' ? t.status === 'done' : t.status !== 'done',
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Tasks" description="What you plan to work on during focus sessions." />
      <form
        onSubmit={add}
        className="mb-6 flex flex-wrap items-start gap-2 rounded-xl border bg-card p-3 shadow-sm"
      >
        <div className="min-w-48 flex-1">
          <Input
            aria-label="New task title"
            placeholder="Add a task, e.g. Solve 3 LeetCode problems"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={titleError ? true : undefined}
          />
          {titleError ? <p className="mt-1 text-xs text-destructive">{titleError}</p> : null}
        </div>
        <Select
          aria-label="Category"
          className="w-44"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {TASK_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Estimate in minutes"
          type="number"
          min={1}
          placeholder="min"
          className="w-20"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
        <Button type="submit" disabled={!title.trim() || create.isPending}>
          Add
        </Button>
      </form>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)} className="mb-3">
        <TabsList aria-label="Filter tasks">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="done">Done</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : items.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<ListTodo />}
          title={filter === 'done' ? 'Nothing finished yet' : 'No tasks'}
          description="Add tasks above, then attach them to a focus session."
        />
      )}
    </div>
  );
}
