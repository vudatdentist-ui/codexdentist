"use client";

import { MessageSquareText, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { addCommunityCommentAction, createCommunityPostAction, deleteCommunityPostAction } from "@/app/(app)/community/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, PanelHeader } from "@/components/suite-primitives";
import { communityPosts } from "@/lib/data";
import type { CommunityPostSummary, CommunityWorkspace } from "@/lib/community-types";

const communityText = {
  vi: {
    addComment: "Thêm bình luận",
    allClinics: "Tất cả phòng khám",
    announcement: "Thông báo",
    body: "Nội dung",
    bodyPlaceholder: "Viết cập nhật, quyết định cần chốt hoặc checklist.",
    caseDiscussion: "Thảo luận ca",
    clinic: "Phòng khám",
    databaseLive: "",
    delete: "Xóa",
    deleteConfirm: "Xóa bài đăng nội bộ này? Các bình luận trong bài cũng sẽ bị xóa.",
    demoMode: "",
    heading: "Câu hỏi lâm sàng, bàn giao, thông báo",
    internalCommunity: "Cộng đồng nội bộ",
    newPost: "Bài đăng mới",
    policy: "Chính sách",
    publish: "Đăng",
    replies: "phản hồi",
    reply: "Trả lời",
    share: "Chia sẻ",
    shiftHandoff: "Bàn giao ca",
    tags: "Thẻ",
    tagsPlaceholder: "implant, bàn giao, tái khám",
    title: "Tiêu đề",
    titlePlaceholder: "Bàn giao, hỏi ca, thông báo",
    training: "Đào tạo",
    type: "Loại",
  },
  en: {
    addComment: "Add comment",
    allClinics: "All clinics",
    announcement: "Announcement",
    body: "Body",
    bodyPlaceholder: "Share the update, decision, or checklist.",
    caseDiscussion: "Case discussion",
    clinic: "Clinic",
    databaseLive: "",
    delete: "Delete",
    deleteConfirm: "Delete this internal post? Its comments will also be deleted.",
    demoMode: "",
    heading: "Clinical questions, handoffs, announcements",
    internalCommunity: "Internal community",
    newPost: "New post",
    policy: "Policy",
    publish: "Publish",
    replies: "replies",
    reply: "Reply",
    share: "Share",
    shiftHandoff: "Shift handoff",
    tags: "Tags",
    tagsPlaceholder: "implant, handoff, recall",
    title: "Title",
    titlePlaceholder: "Handoff, case question, announcement",
    training: "Training",
    type: "Type",
  },
} satisfies Record<Language, Record<string, string>>;

const noticeText: Record<string, Record<Language, string>> = {
  "community-created": {
    vi: "Đã đăng bài nội bộ.",
    en: "Community post published.",
  },
  "community-commented": {
    vi: "Đã thêm bình luận.",
    en: "Comment added.",
  },
  "community-deleted": {
    vi: "Đã xóa bài đăng nội bộ.",
    en: "Community post deleted.",
  },
  "community-denied": {
    vi: "Vai trò này không thể thay đổi cộng đồng nội bộ.",
    en: "This role cannot change community posts.",
  },
  "community-missing": {
    vi: "Nhập đủ loại, tiêu đề và nội dung bài đăng.",
    en: "Complete post type, title, and body.",
  },
  "community-comment-missing": {
    vi: "Nhập nội dung bình luận.",
    en: "Enter a comment body.",
  },
  "community-not-found": {
    vi: "Không tìm thấy bài đăng trong phạm vi phòng khám này.",
    en: "The post could not be found in this clinic scope.",
  },
  "community-database": {
    vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.",
    en: "The change could not be saved. Please try again.",
  },
} satisfies Record<string, Record<Language, string>>;

export function CommunityPanel({
  communityWorkspace,
  visibleClinicIds,
}: {
  communityWorkspace?: CommunityWorkspace | null;
  visibleClinicIds: Set<string>;
}) {
  const { language } = useAppLanguage();
  const text = communityText[language];
  const searchParams = useSearchParams();
  const notice = noticeFor(visibleActionNoticeParam(searchParams.get("notice")), language);
  const canMutate = communityWorkspace?.canMutate ?? false;
  const formClinics = communityWorkspace?.clinics.filter((clinic) =>
    visibleClinicIds.has(clinic.id),
  );
  const postSource: CommunityPostSummary[] =
    communityWorkspace?.posts ??
    communityPosts.map((post) => ({
      ...post,
      comments: [],
    }));
  const visiblePosts = postSource.filter(
    (post) => !post.clinicId || visibleClinicIds.has(post.clinicId),
  );
  const formReady = Boolean(canMutate && formClinics?.length);

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{text.internalCommunity}</p>
          <h2>{text.heading}</h2>
        </div>
        <SourceBadge source={communityWorkspace?.source} />
      </div>

      {(communityWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(communityWorkspace?.message, language)}
        </div>
      )}

      <section className="panel">
        <PanelHeader icon={MessageSquareText} title={text.newPost} action={text.share} />
        <form action={createCommunityPostAction} className="community-form">
          <label>
            {text.type}
            <select name="type" disabled={!formReady} defaultValue="SHIFT_HANDOFF" required>
              <option value="SHIFT_HANDOFF">{text.shiftHandoff}</option>
              <option value="CASE_DISCUSSION">{text.caseDiscussion}</option>
              <option value="ANNOUNCEMENT">{text.announcement}</option>
              <option value="TRAINING">{text.training}</option>
              <option value="POLICY">{text.policy}</option>
            </select>
          </label>
          <label>
            {text.clinic}
            <select name="clinicId" disabled={!formReady} required>
              <option value="all">{text.allClinics}</option>
              {formClinics?.map((clinic) => (
                <option value={clinic.id} key={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </label>
          <label className="community-title">
            {text.title}
            <input name="title" placeholder={text.titlePlaceholder} disabled={!formReady} required />
          </label>
          <label className="community-body">
            {text.body}
            <textarea name="body" placeholder={text.bodyPlaceholder} disabled={!formReady} required />
          </label>
          <label className="community-tags">
            {text.tags}
            <input name="tags" placeholder={text.tagsPlaceholder} disabled={!formReady} />
          </label>
          <button className="primary-button" type="submit" disabled={!formReady}>
            <MessageSquareText size={16} />
            {text.publish}
          </button>
        </form>
      </section>

      <div className="community-grid">
        {visiblePosts.length > 0 ? (
          visiblePosts.map((post) => (
            <article className="panel community-card" key={post.id}>
              <div className="plan-head">
                <div>
                  <span>{communityTypeLabel(post.type, language)}</span>
                  <strong>{post.title}</strong>
                </div>
                {canMutate && (
                  <form
                    action={deleteCommunityPostAction}
                    onSubmit={(event) => {
                      if (!window.confirm(text.deleteConfirm)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input name="postId" type="hidden" value={post.id} />
                    <button className="icon-button small danger-icon" type="submit" aria-label={text.delete}>
                      <Trash2 size={16} />
                    </button>
                  </form>
                )}
              </div>
              <p>{post.body}</p>
              <div className="community-meta">
                <span>{post.author}</span>
                <span>{post.clinic}</span>
                {post.createdAt && <span>{post.createdAt}</span>}
                <span>
                  {post.replies} {text.replies}
                </span>
              </div>
              <div className="flag-list">
                {post.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              {post.comments.length > 0 && (
                <div className="comment-list">
                  {post.comments.map((comment) => (
                    <div className="comment-row" key={comment.id}>
                      <strong>{comment.author}</strong>
                      <span>{comment.createdAt}</span>
                      <p>{comment.body}</p>
                    </div>
                  ))}
                </div>
              )}
              {canMutate && (
                <form action={addCommunityCommentAction} className="comment-form">
                  <input name="postId" type="hidden" value={post.id} />
                  <input name="body" placeholder={text.addComment} required />
                  <button type="submit">{text.reply}</button>
                </form>
              )}
            </article>
          ))
        ) : (
          <EmptyState label={workspaceMessageText(communityWorkspace?.message, language) ?? text.heading} />
        )}
      </div>
    </section>
  );
}

function communityTypeLabel(type: string, language: Language) {
  const text = communityText[language];
  const normalized = normalizeSearchText(type);

  if (normalized.includes("case")) {
    return text.caseDiscussion;
  }

  if (normalized.includes("handoff") || normalized.includes("shift")) {
    return text.shiftHandoff;
  }

  if (normalized.includes("training")) {
    return text.training;
  }

  if (normalized.includes("policy")) {
    return text.policy;
  }

  return text.announcement;
}

function noticeFor(notice: string | null, language: Language) {
  if (!notice) {
    return null;
  }

  return noticeText[notice]?.[language] ?? null;
}

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { language } = useAppLanguage();
  const text = communityText[language];

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? text.databaseLive : text.demoMode}
    </span>
  );
}

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") {
    return message;
  }

  const viMessages: Record<string, string> = {
    "Chưa có dữ liệu trong phạm vi hiện tại.":
      "Chưa có dữ liệu trong phạm vi hiện tại.",
  };

  return viMessages[message] ?? message;
}

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
