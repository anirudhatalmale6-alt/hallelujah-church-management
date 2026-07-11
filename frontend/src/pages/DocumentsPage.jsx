import React, { useState, useEffect, useRef, Suspense } from 'react';
import { documents, meetingNotes } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

// The PDF engine is only fetched the first time someone opens a PDF, so it
// doesn't slow down the rest of the system.
const PdfReader = React.lazy(() => import('../components/PdfReader'));
import {
  FileText, Upload, Search, Download, Trash2, Edit2, X, Eye,
  File, FileImage, FileVideo, FileAudio, FileSpreadsheet, Plus,
  FileArchive, BookOpen, Calendar, Paperclip, Printer, ChevronDown, ChevronUp,
  Save, Clock, User
} from 'lucide-react';

const CATEGORY_LABELS = {
  sermon: 'Sermons',
  meeting_notes: 'Meeting Notes',
  policy: 'Policies',
  form: 'Forms',
  other: 'Other',
};

const CATEGORY_ICONS = {
  sermon: '📖',
  meeting_notes: '📝',
  policy: '📋',
  form: '📄',
  other: '📁',
};

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(type) {
  if (!type) return <File size={20} className="text-gray-400" />;
  if (type.startsWith('image/')) return <FileImage size={20} className="text-blue-500" />;
  if (type.startsWith('video/')) return <FileVideo size={20} className="text-purple-500" />;
  if (type.startsWith('audio/')) return <FileAudio size={20} className="text-green-500" />;
  if (type.includes('pdf')) return <FileText size={20} className="text-red-500" />;
  if (type.includes('spreadsheet') || type.includes('excel') || type.includes('csv'))
    return <FileSpreadsheet size={20} className="text-green-600" />;
  return <File size={20} className="text-gray-400" />;
}

// Files the browser can show on its own. Anything else (Word, Excel,
// PowerPoint, zip...) has to be downloaded to be opened.
function canPreview(type, name = '') {
  const t = (type || '').toLowerCase();
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (t.includes('pdf') || ext === 'pdf') return 'pdf';
  if (t.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (t.startsWith('video/') || ['mp4', 'webm', 'ogg', 'mov'].includes(ext)) return 'video';
  if (t.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac'].includes(ext)) return 'audio';
  if (t.startsWith('text/') || ['txt', 'csv', 'log', 'md'].includes(ext)) return 'text';
  return null;
}

// ===================== FILE VIEWER =====================
// Opens a document inside the system - no download, no leaving the page.
function FileViewer({ file, onClose }) {
  if (!file) return null;
  const kind = canPreview(file.type, file.name);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
          <FileText size={18} className="text-primary-700 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 truncate">{file.title}</div>
            <div className="text-xs text-gray-500 truncate">{file.name}</div>
          </div>
          <a href={file.downloadUrl} target="_blank" rel="noreferrer"
            className="btn btn-sm bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1" title="Download a copy">
            <Download size={14} /> <span className="hidden sm:inline">Download</span>
          </a>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1" title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 bg-gray-100 overflow-auto">
          {kind === 'pdf' ? (
            <Suspense fallback={
              <div className="w-full h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700" />
              </div>
            }>
              <PdfReader url={file.viewUrl} printUrl={file.viewUrl} />
            </Suspense>
          ) : kind === 'text' ? (
            <iframe src={file.viewUrl} title={file.title} className="w-full h-full border-0" />
          ) : kind === 'image' ? (
            <div className="w-full h-full flex items-center justify-center p-4">
              <img src={file.viewUrl} alt={file.title} className="max-w-full max-h-full object-contain" />
            </div>
          ) : kind === 'video' ? (
            <div className="w-full h-full flex items-center justify-center bg-black p-2">
              <video src={file.viewUrl} controls className="max-w-full max-h-full" />
            </div>
          ) : kind === 'audio' ? (
            <div className="w-full h-full flex items-center justify-center p-6">
              <audio src={file.viewUrl} controls className="w-full max-w-lg" />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 gap-3">
              <File size={48} className="text-gray-300" />
              <div className="text-gray-700 font-medium">This file type can't be shown in the browser</div>
              <div className="text-sm text-gray-500 max-w-md">
                Word, Excel, PowerPoint and zip files need to be opened in their own program.
                PDFs, images, videos and audio open right here.
              </div>
              <a href={file.downloadUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-2 flex items-center gap-1">
                <Download size={14} /> Download this file
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== DOCUMENTS TAB =====================
function DocumentsTab() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', category: '', description: '' });
  const [viewing, setViewing] = useState(null);

  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadCategory, setUploadCategory] = useState('other');
  const [uploadDescription, setUploadDescription] = useState('');
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterCat) params.category = filterCat;
      if (search) params.search = search;
      const res = await documents.list(params);
      setDocs(res.documents || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterCat]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (uploadFiles.length === 0) return;
    setUploading(true);
    const progress = uploadFiles.map((f) => ({ name: f.name, status: 'pending' }));
    setUploadProgress([...progress]);

    for (let i = 0; i < uploadFiles.length; i++) {
      progress[i].status = 'uploading';
      setUploadProgress([...progress]);
      try {
        const title = uploadFiles[i].name.replace(/\.[^/.]+$/, '');
        await documents.upload(uploadFiles[i], title, uploadCategory, uploadDescription);
        progress[i].status = 'done';
      } catch {
        progress[i].status = 'error';
      }
      setUploadProgress([...progress]);
    }

    setTimeout(() => {
      setShowUpload(false);
      setUploadFiles([]);
      setUploadCategory('other');
      setUploadDescription('');
      setUploadProgress([]);
      load();
    }, 1000);
    setUploading(false);
  };

  const handleEdit = (doc) => {
    setEditing(doc.id);
    setEditForm({ title: doc.title, category: doc.category, description: doc.description || '' });
  };

  const handleSaveEdit = async () => {
    try {
      await documents.update(editing, editForm);
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message || 'Update failed');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this document? The file will be permanently removed.')) return;
    try {
      await documents.delete(id);
      load();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  const categoryCounts = {};
  docs.forEach(d => { categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1; });

  return (
    <div>
      {/* Category cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <button
          onClick={() => setFilterCat('')}
          className={`card p-3 text-center transition-colors cursor-pointer ${!filterCat ? 'ring-2 ring-primary-500' : ''}`}
        >
          <div className="text-2xl mb-1">📂</div>
          <div className="text-xs font-medium text-gray-700">All</div>
          <div className="text-lg font-bold text-gray-900">{docs.length}</div>
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilterCat(filterCat === key ? '' : key)}
            className={`card p-3 text-center transition-colors cursor-pointer ${filterCat === key ? 'ring-2 ring-primary-500' : ''}`}
          >
            <div className="text-2xl mb-1">{CATEGORY_ICONS[key]}</div>
            <div className="text-xs font-medium text-gray-700">{label}</div>
            <div className="text-lg font-bold text-gray-900">{categoryCounts[key] || 0}</div>
          </button>
        ))}
      </div>

      {/* Search + Upload button */}
      <div className="card p-4 mb-4">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-9" placeholder="Search documents..."
            />
          </div>
          <button onClick={() => setShowUpload(true)} className="btn btn-primary whitespace-nowrap">
            <Upload size={14} /> Upload Files
          </button>
        </div>
      </div>

      {/* Upload modal - supports multiple files */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !uploading && setShowUpload(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">Upload Documents</h3>
              {!uploading && <button onClick={() => setShowUpload(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>}
            </div>
            <form onSubmit={handleUpload} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Files (select multiple)</label>
                <input
                  ref={fileRef} type="file" multiple
                  onChange={e => {
                    setUploadFiles(Array.from(e.target.files));
                  }}
                  className="input"
                />
                {uploadFiles.length > 1 && (
                  <p className="text-xs text-blue-600 mt-1">{uploadFiles.length} files selected</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category (for all files)</label>
                <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} className="input">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional, shared)</label>
                <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)}
                  className="input" rows={2} placeholder="Brief description..." />
              </div>

              {/* Upload progress */}
              {uploadProgress.length > 0 && (
                <div className="space-y-1 border rounded-lg p-3 bg-gray-50">
                  {uploadProgress.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {p.status === 'pending' && <div className="w-3 h-3 rounded-full bg-gray-300" />}
                      {p.status === 'uploading' && <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />}
                      {p.status === 'done' && <div className="w-3 h-3 rounded-full bg-green-500" />}
                      {p.status === 'error' && <div className="w-3 h-3 rounded-full bg-red-500" />}
                      <span className="truncate">{p.name}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => !uploading && setShowUpload(false)} disabled={uploading} className="btn bg-gray-100 text-gray-700">Cancel</button>
                <button type="submit" disabled={uploadFiles.length === 0 || uploading} className="btn btn-primary">
                  {uploading ? 'Uploading...' : `Upload ${uploadFiles.length > 1 ? uploadFiles.length + ' Files' : 'File'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Documents list */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : docs.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No documents found</div>
        ) : (
          <div className="divide-y">
            {docs.map(doc => (
              <div key={doc.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                <div className="flex-shrink-0">
                  {getFileIcon(doc.file_type)}
                </div>
                <div className="flex-1 min-w-0">
                  {editing === doc.id ? (
                    <div className="space-y-2">
                      <input type="text" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                        className="input text-sm" />
                      <div className="flex gap-2">
                        <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className="input text-sm w-auto">
                          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <button onClick={handleSaveEdit} className="btn btn-primary btn-sm">Save</button>
                        <button onClick={() => setEditing(null)} className="btn btn-sm bg-gray-100 text-gray-600">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setViewing({
                          title: doc.title, name: doc.file_name, type: doc.file_type,
                          viewUrl: documents.viewUrl(doc.id), downloadUrl: documents.downloadUrl(doc.id),
                        })}
                        className="font-medium text-gray-900 truncate hover:text-primary-700 hover:underline text-left w-full"
                        title="Click to read this document"
                      >
                        {doc.title}
                      </button>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
                          {CATEGORY_LABELS[doc.category] || doc.category}
                        </span>
                        <span>{formatSize(doc.file_size)}</span>
                        <span>{doc.file_name}</span>
                        <span>by {doc.uploaded_by_name}</span>
                        <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                      </div>
                      {doc.description && <div className="text-xs text-gray-500 mt-1">{doc.description}</div>}
                    </>
                  )}
                </div>
                {editing !== doc.id && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setViewing({
                        title: doc.title, name: doc.file_name, type: doc.file_type,
                        viewUrl: documents.viewUrl(doc.id), downloadUrl: documents.downloadUrl(doc.id),
                      })}
                      className="text-primary-700 hover:text-primary-900" title="View in the system">
                      <Eye size={17} />
                    </button>
                    <a href={documents.downloadUrl(doc.id)} target="_blank" rel="noreferrer"
                      className="text-blue-600 hover:text-blue-800" title="Download">
                      <Download size={16} />
                    </a>
                    <button onClick={() => handleEdit(doc)} className="text-gray-400 hover:text-blue-600" title="Edit">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDelete(doc.id)} className="text-gray-400 hover:text-red-600" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <FileViewer file={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

// ===================== MEETING NOTES TAB =====================
function MeetingNotesTab() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedNote, setExpandedNote] = useState(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [attachUploading, setAttachUploading] = useState(false);
  const [viewingAtt, setViewingAtt] = useState(null);
  const attachRef = useRef(null);

  const emptyForm = { title: '', meeting_date: new Date().toISOString().split('T')[0], subjects: [''], content: '' };
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      const res = await meetingNotes.list(params);
      setNotes(res.notes || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadNote = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedNote(null);
      return;
    }
    setExpandedId(id);
    setLoadingNote(true);
    try {
      const res = await meetingNotes.view(id);
      setExpandedNote(res.note);
    } catch {}
    setLoadingNote(false);
  };

  const openEdit = (note) => {
    setEditingId(note.id);
    setForm({
      title: note.title,
      meeting_date: note.meeting_date,
      subjects: (note.subjects && note.subjects.length > 0) ? note.subjects : [''],
      content: note.content || '',
    });
    setShowForm(true);
  };

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const handleSave = async () => {
    const subjects = form.subjects.filter(s => s.trim());
    const payload = { ...form, subjects };
    try {
      if (editingId) {
        await meetingNotes.update(editingId, payload);
      } else {
        await meetingNotes.create(payload);
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      load();
      if (expandedId === editingId) {
        const res = await meetingNotes.view(editingId);
        setExpandedNote(res.note);
      }
    } catch (err) {
      alert(err.message || 'Save failed');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this meeting note and all its attachments?')) return;
    try {
      await meetingNotes.delete(id);
      if (expandedId === id) { setExpandedId(null); setExpandedNote(null); }
      load();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleAttachUpload = async (noteId) => {
    const files = attachRef.current?.files;
    if (!files || files.length === 0) return;
    setAttachUploading(true);
    for (const file of files) {
      try {
        await meetingNotes.uploadAttachment(noteId, file);
      } catch {}
    }
    attachRef.current.value = '';
    setAttachUploading(false);
    const res = await meetingNotes.view(noteId);
    setExpandedNote(res.note);
  };

  const handleAttachDelete = async (attId, noteId) => {
    if (!confirm('Delete this attachment?')) return;
    try {
      await meetingNotes.deleteAttachment(attId);
      const res = await meetingNotes.view(noteId);
      setExpandedNote(res.note);
    } catch {}
  };

  const handlePrint = (note) => {
    const subjects = note.subjects || [];
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>${note.title}</title><style>
      body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #222; }
      h1 { font-size: 24px; margin-bottom: 4px; }
      .meta { color: #666; font-size: 14px; margin-bottom: 20px; border-bottom: 2px solid #1a365d; padding-bottom: 10px; }
      .subjects { margin-bottom: 20px; }
      .subjects h3 { font-size: 16px; margin-bottom: 8px; color: #1a365d; }
      .subjects ul { padding-left: 20px; }
      .subjects li { margin-bottom: 4px; }
      .content { white-space: pre-wrap; line-height: 1.6; }
      .footer { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; font-size: 12px; color: #999; }
      @media print { body { margin: 0; } }
    </style></head><body>
      <h1>${note.title}</h1>
      <div class="meta">Date: ${new Date(note.meeting_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} | By: ${note.created_by_name || 'Unknown'}</div>
      ${subjects.length > 0 ? `<div class="subjects"><h3>Subjects</h3><ul>${subjects.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
      <div class="content">${(note.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="footer">Hallelujah In The City - Meeting Notes</div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <div>
      {/* Search + New Note */}
      <div className="card p-4 mb-4">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-9" placeholder="Search meeting notes..."
            />
          </div>
          <button onClick={openNew} className="btn btn-primary whitespace-nowrap">
            <Plus size={14} /> New Note
          </button>
        </div>
      </div>

      {/* New / Edit Note Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">{editingId ? 'Edit Meeting Note' : 'New Meeting Note'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="input" placeholder="e.g. Board Meeting - June 2026" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Date</label>
                  <input type="date" value={form.meeting_date} onChange={e => setForm(f => ({ ...f, meeting_date: e.target.value }))}
                    className="input" />
                </div>
              </div>

              {/* Subjects */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subjects / Agenda Items</label>
                {form.subjects.map((subj, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text" value={subj}
                      onChange={e => {
                        const s = [...form.subjects];
                        s[i] = e.target.value;
                        setForm(f => ({ ...f, subjects: s }));
                      }}
                      className="input flex-1" placeholder={`Subject ${i + 1}`}
                    />
                    {form.subjects.length > 1 && (
                      <button type="button" onClick={() => {
                        const s = form.subjects.filter((_, j) => j !== i);
                        setForm(f => ({ ...f, subjects: s }));
                      }} className="text-red-400 hover:text-red-600 px-2"><X size={16} /></button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setForm(f => ({ ...f, subjects: [...f.subjects, ''] }))}
                  className="text-sm text-blue-600 hover:text-blue-800">+ Add Subject</button>
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Content</label>
                <textarea
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  className="input font-mono text-sm"
                  rows={12}
                  placeholder="Type your meeting notes here..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="btn bg-gray-100 text-gray-700">Cancel</button>
                <button onClick={handleSave} disabled={!form.title || !form.meeting_date} className="btn btn-primary">
                  <Save size={14} /> {editingId ? 'Update Note' : 'Save Note'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <div className="card p-8 text-center text-gray-400">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="card p-8 text-center text-gray-400">
          <BookOpen size={40} className="mx-auto mb-3 text-gray-300" />
          <p>No meeting notes yet</p>
          <button onClick={openNew} className="btn btn-primary mt-3"><Plus size={14} /> Create First Note</button>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map(note => (
            <div key={note.id} className="card overflow-hidden">
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => loadNote(note.id)}
              >
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <BookOpen size={20} className="text-blue-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{note.title}</div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap mt-1">
                    <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(note.meeting_date).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1"><User size={12} /> {note.created_by_name}</span>
                    {note.subjects && note.subjects.length > 0 && (
                      <span>{note.subjects.length} subject{note.subjects.length > 1 ? 's' : ''}</span>
                    )}
                    {note.attachment_count > 0 && (
                      <span className="flex items-center gap-1"><Paperclip size={12} /> {note.attachment_count} file{note.attachment_count > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={e => { e.stopPropagation(); openEdit(note); }} className="text-gray-400 hover:text-blue-600" title="Edit">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handlePrint(expandedNote || note); }} className="text-gray-400 hover:text-blue-600" title="Print">
                    <Printer size={14} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(note.id); }} className="text-gray-400 hover:text-red-600" title="Delete">
                    <Trash2 size={14} />
                  </button>
                  {expandedId === note.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </div>

              {/* Expanded view */}
              {expandedId === note.id && (
                <div className="border-t">
                  {loadingNote ? (
                    <div className="p-4 text-center text-gray-400">Loading...</div>
                  ) : expandedNote ? (
                    <div className="p-4 space-y-4">
                      {/* Subjects */}
                      {expandedNote.subjects && expandedNote.subjects.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-2">Subjects / Agenda</h4>
                          <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                            {expandedNote.subjects.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}

                      {/* Content */}
                      {expandedNote.content && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-2">Notes</h4>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-4 leading-relaxed">
                            {expandedNote.content}
                          </div>
                        </div>
                      )}

                      {/* Attachments */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-700">Attachments</h4>
                          <label className="btn btn-sm bg-gray-100 text-gray-700 cursor-pointer">
                            <Paperclip size={12} /> Attach File
                            <input
                              ref={attachRef}
                              type="file"
                              multiple
                              className="hidden"
                              onChange={() => handleAttachUpload(note.id)}
                            />
                          </label>
                        </div>
                        {attachUploading && <div className="text-xs text-blue-600 mb-2">Uploading...</div>}
                        {expandedNote.attachments && expandedNote.attachments.length > 0 ? (
                          <div className="space-y-2">
                            {expandedNote.attachments.map(att => (
                              <div key={att.id} className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg px-3 py-2">
                                {getFileIcon(att.file_type)}
                                <div className="flex-1 min-w-0">
                                  <button
                                    onClick={() => setViewingAtt({
                                      title: att.file_name, name: att.file_name, type: att.file_type,
                                      viewUrl: meetingNotes.attachmentViewUrl(att.id),
                                      downloadUrl: meetingNotes.attachmentDownloadUrl(att.id),
                                    })}
                                    className="truncate font-medium text-gray-700 hover:text-primary-700 hover:underline text-left w-full"
                                    title="Click to view">
                                    {att.file_name}
                                  </button>
                                  <div className="text-xs text-gray-500">{formatSize(att.file_size)} - {att.uploaded_by_name}</div>
                                </div>
                                <button
                                  onClick={() => setViewingAtt({
                                    title: att.file_name, name: att.file_name, type: att.file_type,
                                    viewUrl: meetingNotes.attachmentViewUrl(att.id),
                                    downloadUrl: meetingNotes.attachmentDownloadUrl(att.id),
                                  })}
                                  className="text-primary-700 hover:text-primary-900" title="View in the system"><Eye size={15} /></button>
                                <a href={meetingNotes.attachmentDownloadUrl(att.id)} target="_blank" rel="noreferrer"
                                  className="text-blue-600 hover:text-blue-800"><Download size={14} /></a>
                                <button onClick={() => handleAttachDelete(att.id, note.id)}
                                  className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">No attachments</p>
                        )}
                      </div>

                      {/* Meta */}
                      <div className="text-xs text-gray-400 pt-2 border-t flex gap-4 flex-wrap">
                        <span>Created: {new Date(expandedNote.created_at).toLocaleString()}</span>
                        {expandedNote.updated_by_name && <span>Last edited by: {expandedNote.updated_by_name} at {new Date(expandedNote.updated_at).toLocaleString()}</span>}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <FileViewer file={viewingAtt} onClose={() => setViewingAtt(null)} />
    </div>
  );
}

// ===================== MAIN PAGE =====================
export default function DocumentsPage() {
  const [tab, setTab] = useState('documents');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents & Notes</h1>
          <p className="text-sm text-gray-500">File storage, meeting notes, and records</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('documents')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            tab === 'documents' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <FileArchive size={16} /> Documents
        </button>
        <button
          onClick={() => setTab('notes')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            tab === 'notes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <BookOpen size={16} /> Meeting Notes
        </button>
      </div>

      {tab === 'documents' ? <DocumentsTab /> : <MeetingNotesTab />}
    </div>
  );
}
