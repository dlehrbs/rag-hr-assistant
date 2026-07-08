'use client';

import { useRef, useState, useEffect } from 'react';
import { FileText, Upload, Trash2, Loader2, CheckCircle2, AlertCircle, Plus, Lock, Brain, ListChecks, Check } from 'lucide-react';
import { useProjectStore } from '@/store/useProjectStore';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

const ACCEPT = '.pdf,.txt,.md,.html,.htm,.docx,.xlsx,.pptx';

function fileBadge(filename: string): string {
  const ext = (filename.split('.').pop() || '').toUpperCase();
  const known = ['PDF', 'TXT', 'MD', 'HTML', 'HTM', 'DOCX', 'XLSX', 'XLS', 'PPTX'];
  return known.includes(ext) ? ext : 'FILE';
}

export default function ProjectFilePanel({ projectId, canEdit = true }: { projectId: string; canEdit?: boolean }) {
  const { getProject, uploadFile, deleteFile, updateProject } = useProjectStore();
  const project = getProject(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 지침: 로컬 state로 입력 관리(키스트로크마다 PUT 금지) → blur/버튼에서 1회 저장
  const [instrDraft, setInstrDraft] = useState(project?.instruction ?? '');
  const [instrSaved, setInstrSaved] = useState(false);
  useEffect(() => { setInstrDraft(project?.instruction ?? ''); }, [project?.id, project?.instruction]);
  const saveInstruction = async () => {
    const v = instrDraft.slice(0, 1500);
    if (v === (project?.instruction ?? '')) return;
    await updateProject(projectId, { instruction: v });
    setInstrSaved(true);
    setTimeout(() => setInstrSaved(false), 1500);
  };
  const [dragOver, setDragOver] = useState(false);
  const [isUploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  // PDF 정밀 분석(LlamaParse) 여부. PDF에만 적용, 그 외 형식은 항상 일반.
  const [pdfQuality, setPdfQuality] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    for (const file of Array.from(files)) {
      const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
      if (!ACCEPT.includes(ext)) { setUploadError(`지원하지 않는 형식: ${file.name}`); continue; }
      // PDF + 정밀 토글 ON 일 때만 quality. 나머지는 fast.
      const mode = (ext === '.pdf' && pdfQuality) ? 'quality' : 'fast';
      try { await uploadFile(projectId, file, mode); }
      catch (e: any) { setUploadError(e?.message || '업로드 실패'); }
    }
    setUploading(false);
  };

  return (
    <div className="w-[340px] flex-shrink-0 h-full overflow-y-auto border-l border-gray-200 dark:border-gray-800 p-5 space-y-4">
      {/* 메모리 (비활성 플레이스홀더) */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 opacity-60 select-none">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">
            <Brain size={15} className="text-gray-400" /> 메모리
          </div>
          <span className="flex items-center gap-1 text-[11px] text-gray-400 border border-gray-200 dark:border-gray-700 rounded-md px-1.5 py-0.5">
            <Lock size={10} /> 준비 중
          </span>
        </div>
        <p className="text-[12px] text-gray-400 leading-relaxed">프로젝트 메모리 기능은 준비 중입니다.</p>
      </div>

      {/* 지침 (실동작) — 이 프로젝트의 답변 방식 고정 */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">
            <ListChecks size={15} className="text-gray-400" /> 지침
          </div>
          {instrSaved && <span className="flex items-center gap-1 text-[11px] text-green-500"><Check size={11} /> 저장됨</span>}
        </div>
        {canEdit ? (
          <>
            <textarea
              value={instrDraft}
              onChange={(e) => setInstrDraft(e.target.value)}
              maxLength={1500}
              rows={3}
              placeholder={"이 프로젝트의 답변 방식을 지정하세요.\n예: 답변은 항상 표로 정리, 한국어로, 핵심만 간결하게."}
              className="w-full text-[12px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-black/20 p-2 leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-700 dark:text-gray-200"
            />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-gray-400">{instrDraft.length}/1500</span>
              <button
                onClick={saveInstruction}
                disabled={instrDraft.slice(0, 1500) === (project?.instruction ?? '')}
                className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                저장
              </button>
            </div>
          </>
        ) : (
          <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">
            {project?.instruction ? project.instruction : <span className="text-gray-400 italic">설정된 지침이 없습니다.</span>}
          </p>
        )}
      </div>

      {/* 파일 (실제 동작) */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">
            파일 <span className="text-gray-400 font-normal">({project?.files.length || 0})</span>
          </div>
          {canEdit && (
            <button onClick={() => fileInputRef.current?.click()} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-blue-500 transition-colors">
              <Plus size={16} />
            </button>
          )}
        </div>

        {canEdit ? (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-all mb-3 ${dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-blue-400'}`}
            >
              <Upload size={18} className="mx-auto text-gray-400 mb-1.5" />
              <p className="text-[13px] font-medium text-gray-600 dark:text-gray-300">파일 추가</p>
              <p className="text-[10px] text-gray-400 mt-0.5">PDF · Word · Excel · PPT · HTML · txt · md</p>
            </div>
            <input ref={fileInputRef} type="file" accept={ACCEPT} multiple className="hidden"
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
            {/* PDF 정밀 분석 토글 — PDF 업로드 시에만 적용(그 외 형식은 무시) */}
            <label className="flex items-start gap-2 mb-3 cursor-pointer select-none">
              <input type="checkbox" checked={pdfQuality} onChange={(e) => setPdfQuality(e.target.checked)}
                className="mt-0.5 accent-blue-500" />
              <span className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                <span className="font-semibold text-gray-600 dark:text-gray-300">PDF 정밀 분석</span> · 표·레이아웃이 복잡한 PDF에 권장 (처리 시간 김, 한도 초과 시 일반 분석으로 자동 전환)
              </span>
            </label>
            {isUploading && <p className="text-xs text-blue-500 mb-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 업로드 중...</p>}
            {uploadError && <p className="text-xs text-red-500 mb-2 flex items-center gap-1"><AlertCircle size={12} /> {uploadError}</p>}
          </>
        ) : (
          <p className="text-[11px] text-gray-400 italic mb-3 px-1">뷰어 권한 — 파일은 볼 수만 있어요.</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(project?.files || []).map((f) => (
            <div key={f.id} className="group relative rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-100 dark:border-gray-800 p-3">
              <div className="flex items-start justify-between mb-2">
                <FileText size={16} className="text-gray-400" />
                {canEdit && (
                  <button onClick={() => setPendingDelete({ id: f.id, name: f.filename })} className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-all">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <p className="text-[12px] font-medium text-gray-700 dark:text-gray-200 line-clamp-2 leading-snug mb-2 min-h-[2.2em]">{f.filename}</p>
              {f.status === 'indexing' ? (
                <div className="mt-0.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-medium text-orange-500 truncate flex items-center gap-1">
                      <Loader2 size={9} className="animate-spin" /> {f.stage || '처리 중'}
                    </span>
                    <span className="text-[9px] font-mono text-gray-400">{f.progress ?? 0}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div className="h-full bg-orange-400 rounded-full transition-all duration-500" style={{ width: `${f.progress ?? 0}%` }} />
                  </div>
                  {f.startedAt && (
                    <span className="text-[8px] text-gray-400 mt-0.5 block">경과 {Math.round((Date.now() - f.startedAt) / 1000)}초</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300">{fileBadge(f.filename)}</span>
                  {f.status === 'ready' ? <CheckCircle2 size={13} className="text-green-500" />
                    : <AlertCircle size={13} className="text-red-500" />}
                </div>
              )}
            </div>
          ))}
        </div>
        {(project?.files.length || 0) === 0 && (
          <p className="text-xs text-gray-400 italic text-center py-2">업로드된 파일이 없습니다.</p>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="파일 삭제"
        message={`'${pendingDelete?.name ?? ''}' 파일을 이 프로젝트에서 삭제하시겠습니까?\n삭제하면 이 문서로는 더 이상 답변하지 않습니다.`}
        confirmText="삭제"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) deleteFile(projectId, pendingDelete.id); setPendingDelete(null); }}
      />
    </div>
  );
}
