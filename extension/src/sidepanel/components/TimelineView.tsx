import { providerBadge } from "../../shared/ai/providerLabel";
import type { AITimelineEvent, PersonalizationProfile } from "../../shared/types";

export function TimelineView(props: {
  timeline: AITimelineEvent[];
  profile: PersonalizationProfile | null;
}) {
  return (
    <section className="space-y-3">
      {props.profile && (
        <div className="glass rounded-xl p-3 text-sm">
          <h3 className="font-display font-semibold">Personalization</h3>
          <p className="mt-1 text-xs text-[var(--aka-muted)]">
            Tone {props.profile.tone} · Style {props.profile.summaryStyle} ·
            Accepted {props.profile.acceptedActions} · Rejected{" "}
            {props.profile.rejectedActions}
          </p>
          {props.profile.interests.length > 0 && (
            <p className="mt-2 text-xs">
              Interests: {props.profile.interests.slice(0, 12).join(", ")}
            </p>
          )}
        </div>
      )}

      {props.timeline.length === 0 ? (
        <p className="glass rounded-xl p-4 text-sm text-[var(--aka-muted)]">
          AI timeline is empty. Run a summary to start learning history.
        </p>
      ) : (
        <ul className="space-y-2">
          {props.timeline.map((e) => (
            <li key={e.id} className="glass rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--aka-muted)]">
                <span className="font-semibold uppercase tracking-wide text-sky-accent">
                  {e.action}
                </span>
                <span>
                  {providerBadge(e.provider)} · {e.latencyMs}ms ·{" "}
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs">
                {e.preview}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
