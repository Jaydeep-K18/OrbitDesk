import {
  classifySegment,
  type Classification,
  type ClassificationContext,
  type UserOverride,
} from '@focusguard/domain';
import type { AppContext } from '../../context.js';

/**
 * Classification pipeline v1 (rules). Labels every unlabelled segment of a session.
 * Segments the user relabelled (source user_feedback) are never touched.
 */
export class ClassifierService {
  constructor(private readonly ctx: AppContext) {}

  async loadOverrides(userId: string): Promise<UserOverride[]> {
    const rules = await this.ctx.db.domainRule.findMany({
      where: { userId, list: { in: ['relevant', 'always_distraction'] } },
    });
    return rules.map((r) => ({
      host: r.host,
      list: r.list as UserOverride['list'],
      scope: r.scope,
    }));
  }

  async classifySession(sessionId: string, opts: { all?: boolean } = {}): Promise<number> {
    const s = await this.ctx.db.focusSession.findUnique({
      where: { id: sessionId },
      include: {
        domains: true,
        tasks: true,
        segments: { where: opts.all ? { NOT: { labelSource: 'user_feedback' } } : { label: null } },
      },
    });
    if (!s || s.segments.length === 0) return 0;

    const overrides = await this.loadOverrides(s.userId);
    const active = s.domains.filter((d) => d.removedAt === null);
    const base: Omit<ClassificationContext, 'taskCategories'> = {
      blockedHosts: active.filter((d) => d.kind === 'blocked').map((d) => d.host),
      relevantHosts: active.filter((d) => d.kind === 'relevant').map((d) => d.host),
      overrides,
    };
    const allCategories = s.tasks.map((t) => t.taskCategory);

    const updates: { id: string; c: Classification }[] = s.segments.map((seg) => {
      const blockTasks = s.tasks
        .filter((t) => t.blockId && t.blockId === seg.blockId)
        .map((t) => t.taskCategory);
      const c = classifySegment(seg, {
        ...base,
        taskCategories: blockTasks.length > 0 ? blockTasks : allCategories,
      });
      return { id: seg.id, c };
    });

    await this.ctx.db.$transaction(
      updates.map(({ id, c }) =>
        this.ctx.db.activitySegment.update({
          where: { id },
          data: {
            label: c.label,
            confidence: c.confidence,
            labelSource: c.source,
            reasonCode: c.reasonCode,
            explanation: c.explanation,
            classifierVersion: c.classifierVersion,
          },
        }),
      ),
    );
    return updates.length;
  }
}
