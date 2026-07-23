"use client";

import { Activity, ClipboardList, FileText, UsersRound, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  assignLearningContentAction,
  createLearningContentAction,
  updateLearningEnrollmentStatusAction,
} from "@/app/(app)/learning/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import {
  EmptyState,
  MetricCard,
  PanelHeader,
  RecordTile,
  StatusPill as BaseStatusPill,
} from "@/components/suite-primitives";
import type { Clinic } from "@/lib/data";
import { roleLabels, type AppRole } from "@/lib/permissions";
import type { LearningContentSummary, LearningWorkspace } from "@/lib/learning-types";
import type { AppSession } from "@/lib/session";

type LearningResourceKind = "VIDEO" | "IMAGE" | "DOCUMENT" | "MODEL_3D" | "LINK";

type LearningCourseResource = {
  kind: LearningResourceKind;
  title: string;
  url: string;
};

const learningText = {
  vi: {
    assign: "Giao học",
    assignments: "Bài học đã giao",
    body: "Mô tả khóa học",
    cancel: "Hủy",
    close: "Đóng",
    code: "Mã",
    completeConfirm: "Xác nhận hoàn tất bài học và lưu điểm này?",
    content: "Khóa học / tài liệu",
    course: "Khóa học",
    courseAssets: "Tài nguyên khóa học",
    courses: "Khóa học",
    completed: "Hoàn tất",
    create: "Tạo khóa học",
    duration: "Phút học",
    empty: "Chưa có dữ liệu đào tạo",
    heading: "Tài liệu và học tập nội bộ",
    learner: "Nhân viên",
    library: "Thư viện tài liệu",
    materials: "Tài liệu rời",
    media: "Link chính",
    myLearning: "Bài của tôi",
    myStatus: "Trạng thái của tôi",
    notAssigned: "Chưa được giao",
    noCourses: "Chưa có khóa học nào",
    noResources: "Chưa có tài nguyên",
    publish: "Xuất bản",
    resourceTitle: "Tên tài nguyên",
    resourceType: "Loại",
    resourceUrl: "Link video / ảnh / tài liệu",
    score: "Điểm",
    summary: "Tóm tắt",
    title: "Tiêu đề",
    type: "Loại",
    update: "Cập nhật",
    uploadFiles: "Upload file vào khóa học",
    uploadHint: "Có thể chọn nhiều ảnh, video, PDF, tài liệu Office hoặc file 3D.",
    coursesTab: "Khóa học",
    materialsTab: "Tài liệu",
    assignmentsTab: "Bài đã giao",
    eyebrow: "Đào tạo",
    allClinics: "Tất cả phòng khám",
    clinicScope: "Phạm vi phòng khám",
    databaseLive: "",
    demoMode: "",
  },
  en: {
    assign: "Assign",
    assignments: "Assignments",
    body: "Course description",
    cancel: "Cancel",
    close: "Close",
    code: "Code",
    completeConfirm: "Confirm this learning item as completed and save this score?",
    content: "Course / material",
    course: "Course",
    courseAssets: "Course resources",
    courses: "Courses",
    completed: "Completed",
    create: "Create course",
    duration: "Minutes",
    empty: "No learning data yet",
    heading: "Documents and internal learning",
    learner: "Staff member",
    library: "Document library",
    materials: "Standalone materials",
    media: "Primary link",
    myLearning: "My learning",
    myStatus: "My status",
    notAssigned: "Not assigned",
    noCourses: "No courses yet",
    noResources: "No resources yet",
    publish: "Publish",
    resourceTitle: "Resource title",
    resourceType: "Type",
    resourceUrl: "Video / image / document link",
    score: "Score",
    summary: "Summary",
    title: "Title",
    type: "Type",
    update: "Update",
    uploadFiles: "Upload course files",
    uploadHint: "Select multiple images, videos, PDFs, Office documents, or 3D files.",
    coursesTab: "Courses",
    materialsTab: "Materials",
    assignmentsTab: "Assignments",
    eyebrow: "Learning",
    allClinics: "All clinics",
    clinicScope: "Clinic scope",
    databaseLive: "",
    demoMode: "",
  },
} satisfies Record<Language, Record<string, string>>;

const roleText: Record<Language, Record<AppRole, string>> = {
  vi: {
    OWNER: "Chủ hệ thống",
    AREA_MANAGER: "Quản lý khu vực",
    CLINIC_MANAGER: "Quản lý phòng khám",
    DENTIST: "Nha sĩ",
    HYGIENIST: "Điều dưỡng nha khoa",
    FRONT_DESK: "Lễ tân",
    BILLING: "Thu ngân",
    PATIENT: "Bệnh nhân",
  },
  en: roleLabels,
};

const learningStatusText: Record<Language, Record<string, string>> = {
  vi: {
    ASSIGNED: "Đã giao",
    IN_PROGRESS: "Đang học",
    COMPLETED: "Hoàn tất",
    EXPIRED: "Hết hạn",
    PUBLISHED: "Đã xuất bản",
    DRAFT: "Nháp",
    BOOK: "Sách",
    ARTICLE: "Bài viết",
    VIDEO: "Video",
    COURSE: "Khóa học",
    CHECKLIST: "Checklist",
    POLICY: "Quy trình",
  },
  en: {},
};

const learningNoticeText: Record<Language, Record<string, string>> = {
  vi: {
    "learning-content-saved": "Đã lưu nội dung đào tạo.",
    "learning-assigned": "Đã giao bài đào tạo.",
    "learning-progress-updated": "Đã cập nhật tiến độ học.",
    "learning-denied": "Vai trò này không thể sửa dữ liệu đào tạo.",
    "learning-missing": "Cần điền đủ thông tin đào tạo bắt buộc.",
    "learning-score-invalid": "Điểm học tập phải nằm trong khoảng 0-100.",
    "learning-database": "Chưa lưu được thay đổi. Vui lòng thử lại sau.",
    "files-too-large":
      "File vượt giới hạn: ảnh 15 MB, PDF 50 MB, tài liệu 25 MB, file 3D/video 100 MB.",
    "files-too-many": "Mỗi bình luận chỉ đính kèm tối đa 10 file.",
    "files-unsupported": "Hỗ trợ ảnh, PDF, video, file 3D/lab, Word, Excel và PowerPoint.",
  },
  en: {
    "learning-content-saved": "Learning content saved.",
    "learning-assigned": "Learning assignment created.",
    "learning-progress-updated": "Learning progress updated.",
    "learning-denied": "This role cannot change learning records.",
    "learning-missing": "Complete the required learning fields.",
    "learning-score-invalid": "Learning score must be between 0-100.",
    "learning-database": "The learning change could not be saved. Please try again.",
    "files-too-large":
      "File is over the limit: images 20 MB, PDF 200 MB, documents 50 MB, 3D files 500 MB, video 1 GB.",
    "files-too-many": "Attach up to 10 files per comment.",
    "files-unsupported":
      "Supported files: image, PDF, 3D/lab file, video, Word, Excel, and PowerPoint.",
  },
};

export function LearningPanel({
  learningWorkspace,
  session,
  visibleClinics,
}: {
  learningWorkspace?: LearningWorkspace | null;
  session: AppSession;
  visibleClinics: Clinic[];
}) {
  const { language } = useAppLanguage();
  const labels = learningText[language];
  const searchParams = useSearchParams();
  const notice = noticeFor(visibleActionNoticeParam(searchParams.get("notice")), language);
  const [learningModal, setLearningModal] = useState<"course" | "assign" | null>(null);
  const [learningSection, setLearningSection] = useState<"courses" | "materials" | "assignments">("courses");
  const visibleClinicIds = useMemo(
    () => new Set(visibleClinics.map((clinic) => clinic.id)),
    [visibleClinics],
  );
  const clinics = (learningWorkspace?.clinics ?? []).filter((clinic) =>
    visibleClinicIds.has(clinic.id),
  );
  const users = (learningWorkspace?.users ?? []).filter((user) =>
    user.clinicIds.some((clinicId) => visibleClinicIds.has(clinicId)),
  );
  const visibleLearningUserIds = new Set(users.map((user) => user.id));
  const contents = (learningWorkspace?.contents ?? []).filter(
    (content) => content.active && (!content.clinicId || visibleClinicIds.has(content.clinicId)),
  );
  const visibleLearningContentIds = new Set(contents.map((content) => content.id));
  const enrollments = (learningWorkspace?.enrollments ?? []).filter(
    (enrollment) =>
      (!enrollment.clinicId || visibleClinicIds.has(enrollment.clinicId)) &&
      visibleLearningContentIds.has(enrollment.contentId) &&
      visibleLearningUserIds.has(enrollment.userId),
  );
  const canMutate = learningWorkspace?.canMutate ?? false;
  const canSelfUpdate = learningWorkspace?.canSelfUpdate ?? false;
  const courses = contents.filter((content) => content.type === "COURSE");
  const materials = contents.filter((content) => content.type !== "COURSE");
  const resourceCount = courses.reduce(
    (total, course) => total + parseLearningCourseResources(course).length,
    0,
  );
  const myEnrollments = enrollments.filter((enrollment) => enrollment.userId === session.userId);
  const displayedEnrollments = canMutate ? enrollments : myEnrollments;
  const completedCount = displayedEnrollments.filter(
    (enrollment) => enrollment.status === "COMPLETED",
  ).length;
  const resourceRows = [0, 1, 2, 3, 4];
  const learningSectionTabs = [
    { key: "courses", label: labels.coursesTab, count: courses.length },
    { key: "materials", label: labels.materialsTab, count: materials.length },
    { key: "assignments", label: labels.assignmentsTab, count: displayedEnrollments.length },
  ] as const;

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h2>{labels.heading}</h2>
        </div>
        <div className="service-action-row">
          {canMutate && (
            <>
              <button
                className="primary-button"
                type="button"
                onClick={() => setLearningModal("course")}
              >
                <FileText size={16} />
                {labels.create}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={contents.length === 0 || users.length === 0}
                onClick={() => setLearningModal("assign")}
              >
                <UsersRound size={16} />
                {labels.assign}
              </button>
            </>
          )}
          <SourceBadge source={learningWorkspace?.source} />
        </div>
      </div>

      {(learningWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(learningWorkspace?.message, language)}
        </div>
      )}

      <div className="metric-grid learning-metric-grid">
        <MetricCard label={labels.courses} value={String(courses.length)} tone="blue" />
        <MetricCard label={labels.courseAssets} value={String(resourceCount)} tone="teal" />
        <MetricCard label={labels.assignments} value={String(displayedEnrollments.length)} tone="violet" />
        <MetricCard label={labels.completed} value={String(completedCount)} tone="green" />
        <MetricCard label={labels.myLearning} value={String(myEnrollments.length)} tone="violet" />
      </div>

      <nav className="learning-section-tabs" aria-label={labels.heading}>
        {learningSectionTabs.map((tab) => (
          <button
            className={learningSection === tab.key ? "active" : ""}
            key={tab.key}
            type="button"
            onClick={() => setLearningSection(tab.key)}
          >
            {tab.label}
            <span>{tab.count}</span>
          </button>
        ))}
      </nav>

      {learningSection === "courses" && (
        <section className="panel learning-course-panel">
          <PanelHeader icon={ClipboardList} title={labels.courses} action={`${courses.length}`} />
          <div className="learning-course-grid">
            {courses.length > 0 ? (
              courses.map((course) => {
                const resources = parseLearningCourseResources(course);
                const courseEnrollments = displayedEnrollments.filter(
                  (enrollment) => enrollment.contentId === course.id,
                );
                const ownCourseEnrollment = myEnrollments.find(
                  (enrollment) => enrollment.contentId === course.id,
                );

                return (
                  <article className="learning-course-card" key={course.id}>
                    <div className="learning-course-head">
                      <div>
                        <span>{course.code}</span>
                        <strong>{course.title}</strong>
                        <small>
                          {course.durationMinutes ? `${course.durationMinutes} ${labels.duration}` : labels.course}
                        </small>
                      </div>
                      <StatusPill status={course.publishedAt ? "PUBLISHED" : "DRAFT"} />
                    </div>
                    {course.summary && <p>{course.summary}</p>}
                    <div className="learning-course-meta">
                      <span>
                        {canMutate
                          ? `${course.completedCount}/${course.enrollmentCount} ${labels.assignments}`
                          : `${labels.myStatus}: ${
                              ownCourseEnrollment
                                ? displayStatus(ownCourseEnrollment.status, language)
                                : labels.notAssigned
                            }`}
                      </span>
                      <span>{course.authorName ?? labels.library}</span>
                    </div>
                    <div className="learning-resource-list">
                      {resources.length > 0 ? (
                        resources.map((resource) => (
                          <a
                            className="learning-resource-row"
                            href={resource.url}
                            key={`${course.id}-${resource.url}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <span>{learningResourceLabel(resource.kind, language)}</span>
                            <strong>{resource.title}</strong>
                          </a>
                        ))
                      ) : (
                        <small className="learning-empty-inline">{labels.noResources}</small>
                      )}
                    </div>
                    {courseEnrollments.length > 0 && (
                      <div className="learning-enrollment-strip">
                        {courseEnrollments.slice(0, 4).map((enrollment) => (
                          <span key={enrollment.id}>
                            {canMutate
                              ? enrollment.userName
                              : displayStatus(enrollment.status, language)}
                          </span>
                        ))}
                        {courseEnrollments.length > 4 && <span>+{courseEnrollments.length - 4}</span>}
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <EmptyState label={labels.noCourses} />
            )}
          </div>
        </section>
      )}

      {learningSection === "materials" && (
        <section className="content-grid service-management-grid learning-library-grid">
          <section className="panel">
            <PanelHeader icon={FileText} title={labels.materials} action={`${materials.length}`} />
            <div className="record-grid">
              {materials.length > 0 ? (
                materials.map((content) => {
                  const ownEnrollment = myEnrollments.find(
                    (enrollment) => enrollment.contentId === content.id,
                  );

                  return (
                    <RecordTile
                      key={content.id}
                      title={`${content.code} · ${content.title}`}
                      value={
                        canMutate
                          ? `${displayStatus(content.type, language)} · ${content.completedCount}/${content.enrollmentCount}`
                          : `${displayStatus(content.type, language)} · ${labels.myStatus}: ${
                              ownEnrollment
                                ? displayStatus(ownEnrollment.status, language)
                                : labels.notAssigned
                            }`
                      }
                    />
                  );
                })
              ) : (
                <EmptyState label={labels.empty} />
              )}
            </div>
          </section>
        </section>
      )}

      {learningSection === "assignments" && (
        <section className="content-grid service-management-grid learning-library-grid">
          <section className="panel">
            <PanelHeader icon={Activity} title={labels.assignments} action={`${displayedEnrollments.length}`} />
            <div className="invoice-list">
              {displayedEnrollments.slice(0, 12).map((enrollment) => (
                <div className="invoice-row billing-invoice-row" key={enrollment.id}>
                  <div>
                    <strong>
                      {enrollment.contentCode} · {enrollment.contentTitle}
                    </strong>
                    <span>
                      {enrollment.userName} · {displayStatus(enrollment.status, language)}
                    </span>
                    <small>{enrollment.completedAt ?? enrollment.startedAt ?? enrollment.assignedAt}</small>
                  </div>
                  <StatusPill status={enrollment.status} />
                  {(canSelfUpdate || canMutate) && (
                    <form
                      action={updateLearningEnrollmentStatusAction}
                      className="invoice-actions"
                      onSubmit={(event) => {
                        const formData = new FormData(event.currentTarget);

                        if (
                          formData.get("status") === "COMPLETED" &&
                          !window.confirm(labels.completeConfirm)
                        ) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input name="enrollmentId" type="hidden" value={enrollment.id} />
                      <select name="status" defaultValue={enrollment.status}>
                        <option value="ASSIGNED">{displayStatus("ASSIGNED", language)}</option>
                        <option value="IN_PROGRESS">{displayStatus("IN_PROGRESS", language)}</option>
                        <option value="COMPLETED">{displayStatus("COMPLETED", language)}</option>
                      </select>
                      <input
                        name="score"
                        inputMode="decimal"
                        placeholder={labels.score}
                        defaultValue={enrollment.score ?? ""}
                      />
                      <button type="submit">{labels.update}</button>
                    </form>
                  )}
                </div>
              ))}
              {displayedEnrollments.length === 0 && <EmptyState label={labels.empty} />}
            </div>
          </section>
        </section>
      )}

      {learningModal === "course" && (
        <div
          aria-label={labels.create}
          aria-modal="true"
          className="progress-modal-backdrop"
          onClick={() => setLearningModal(null)}
          role="dialog"
        >
          <form
            action={createLearningContentAction}
            className="progress-modal learning-course-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setLearningModal(null)}
          >
            <div className="progress-modal-header">
              <div>
                <span>{labels.library}</span>
                <h3>{labels.create}</h3>
              </div>
              <button
                aria-label={labels.close}
                className="icon-button"
                type="button"
                onClick={() => setLearningModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <input name="type" type="hidden" value="COURSE" />
            <div className="progress-modal-grid modal-form-grid">
              <label>
                {labels.clinicScope}
                <select name="clinicId" disabled={!canMutate}>
                  <option value="all">{labels.allClinics}</option>
                  {clinics.map((clinic) => (
                    <option value={clinic.id} key={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labels.code}
                <input name="code" placeholder="COURSE-001" disabled={!canMutate} />
              </label>
              <label className="clinical-wide">
                {labels.title}
                <input name="title" disabled={!canMutate} required />
              </label>
              <label>
                {labels.duration}
                <input name="durationMinutes" inputMode="numeric" disabled={!canMutate} />
              </label>
              <label>
                {labels.media}
                <input name="mediaUrl" disabled={!canMutate} placeholder="https://..." />
              </label>
              <label className="clinical-wide">
                {labels.summary}
                <textarea name="summary" disabled={!canMutate} />
              </label>
              <label className="clinical-wide">
                {labels.body}
                <textarea name="body" disabled={!canMutate} />
              </label>
              <label className="clinical-wide learning-file-upload">
                {labels.uploadFiles}
                <input
                  name="assetFile"
                  type="file"
                  multiple
                  disabled={!canMutate}
                  accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.stl,.obj,.ply,.glb,.gltf,.3mf,.zip"
                />
                <small>{labels.uploadHint}</small>
              </label>
            </div>
            <div className="learning-resource-form">
              <strong>{labels.courseAssets}</strong>
              {resourceRows.map((row) => (
                <div className="learning-resource-input-row" key={row}>
                  <label>
                    {labels.resourceType}
                    <select name="resourceKind" disabled={!canMutate}>
                      <option value="VIDEO">{learningResourceLabel("VIDEO", language)}</option>
                      <option value="IMAGE">{learningResourceLabel("IMAGE", language)}</option>
                      <option value="DOCUMENT">{learningResourceLabel("DOCUMENT", language)}</option>
                      <option value="LINK">{learningResourceLabel("LINK", language)}</option>
                    </select>
                  </label>
                  <label>
                    {labels.resourceTitle}
                    <input name="resourceTitle" disabled={!canMutate} />
                  </label>
                  <label>
                    {labels.resourceUrl}
                    <input name="resourceUrl" disabled={!canMutate} placeholder="https://..." />
                  </label>
                </div>
              ))}
            </div>
            <label className="inline-checkbox">
              <input name="published" type="checkbox" defaultChecked disabled={!canMutate} />
              {labels.publish}
            </label>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setLearningModal(null)}>
                {labels.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canMutate}>
                <FileText size={16} />
                {labels.create}
              </button>
            </div>
          </form>
        </div>
      )}

      {learningModal === "assign" && (
        <div
          aria-label={labels.assign}
          aria-modal="true"
          className="progress-modal-backdrop"
          onClick={() => setLearningModal(null)}
          role="dialog"
        >
          <form
            action={assignLearningContentAction}
            className="progress-modal learning-assign-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setLearningModal(null)}
          >
            <div className="progress-modal-header">
              <div>
                <span>{labels.learner}</span>
                <h3>{labels.assign}</h3>
              </div>
              <button
                aria-label={labels.close}
                className="icon-button"
                type="button"
                onClick={() => setLearningModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="progress-modal-grid">
              <label>
                {labels.content}
                <select name="contentId" disabled={!canMutate || contents.length === 0} required>
                  {[...courses, ...materials].map((content) => (
                    <option value={content.id} key={content.id}>
                      {content.code} - {content.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labels.learner}
                <select name="userId" disabled={!canMutate || users.length === 0} required>
                  {users.map((user) => (
                    <option value={user.id} key={user.id}>
                      {user.fullName} - {roleText[language][user.role]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setLearningModal(null)}>
                {labels.cancel}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!canMutate || contents.length === 0 || users.length === 0}
              >
                <UsersRound size={16} />
                {labels.assign}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function parseLearningCourseResources(content: LearningContentSummary): LearningCourseResource[] {
  const resources: LearningCourseResource[] = [];
  const seen = new Set<string>();

  for (const asset of content.assets) {
    if (seen.has(asset.url)) {
      continue;
    }

    seen.add(asset.url);
    resources.push({
      kind: learningResourceKindFromAsset(asset.kind),
      title: asset.title || asset.fileName || content.title,
      url: asset.url,
    });
  }

  for (const line of (content.body ?? "").split(/\r?\n/)) {
    const match = line.match(/^\[(VIDEO|IMAGE|DOCUMENT|LINK)\]\s*(.*?)\s*\|\s*(.+)$/i);

    if (!match) {
      continue;
    }

    const kind = match[1].toUpperCase() as LearningResourceKind;
    const title = match[2].trim() || match[3].trim();
    const url = match[3].trim();

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    resources.push({ kind, title, url });
  }

  if (content.mediaUrl && !seen.has(content.mediaUrl)) {
    resources.unshift({
      kind: learningResourceKindFromUrl(content.mediaUrl),
      title: content.title,
      url: content.mediaUrl,
    });
  }

  return resources;
}

function learningResourceKindFromUrl(url: string): LearningResourceKind {
  const normalized = url.toLowerCase();

  if (/\.(mp4|mov|webm)(\?|$)/.test(normalized)) {
    return "VIDEO";
  }

  if (/\.(jpg|jpeg|png|webp|gif|heic)(\?|$)/.test(normalized)) {
    return "IMAGE";
  }

  if (/\.(pdf|doc|docx|ppt|pptx|xls|xlsx)(\?|$)/.test(normalized)) {
    return "DOCUMENT";
  }

  return "LINK";
}

function learningResourceKindFromAsset(kind: LearningContentSummary["assets"][number]["kind"]): LearningResourceKind {
  if (kind === "image") {
    return "IMAGE";
  }

  if (kind === "video") {
    return "VIDEO";
  }

  if (kind === "model3d") {
    return "MODEL_3D";
  }

  return "DOCUMENT";
}

function learningResourceLabel(kind: LearningResourceKind, language: Language) {
  const labels = {
    vi: {
      VIDEO: "Video",
      IMAGE: "Hình ảnh",
      DOCUMENT: "Tài liệu",
      MODEL_3D: "File 3D",
      LINK: "Link",
    },
    en: {
      VIDEO: "Video",
      IMAGE: "Image",
      DOCUMENT: "Document",
      MODEL_3D: "3D file",
      LINK: "Link",
    },
  } as const;

  return labels[language][kind];
}

function noticeFor(notice: string | null, language: Language) {
  if (!notice) {
    return null;
  }

  return learningNoticeText[language][notice] ?? null;
}

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { language } = useAppLanguage();
  const text = learningText[language];

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

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function displayStatus(status: string, language: Language) {
  return learningStatusText[language][status] ?? status;
}
