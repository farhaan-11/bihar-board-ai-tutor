import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import AutoStoriesRounded from '@mui/icons-material/AutoStoriesRounded';
import BiotechRounded from '@mui/icons-material/BiotechRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import EmojiEventsRounded from '@mui/icons-material/EmojiEventsRounded';
import FunctionsRounded from '@mui/icons-material/FunctionsRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import KeyboardArrowRightRounded from '@mui/icons-material/KeyboardArrowRightRounded';
import MenuBookRounded from '@mui/icons-material/MenuBookRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import ScienceRounded from '@mui/icons-material/ScienceRounded';
import TranslateRounded from '@mui/icons-material/TranslateRounded';
import ShuffleRounded from '@mui/icons-material/ShuffleRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import ZunoMark from '../components/ZunoMark.jsx';
import QuizModal from '../components/QuizModal.jsx';
import { fetchStudyMap, fetchQuizHistory, fetchQuizAttemptDetail } from '../api/tutorApi.js';

// Server sends all 3 languages — same fallback rule as QuizModal (Zuno always
// speaks Hinglish by default).
const pickText = (text) => text?.hinglish || text?.en || '';

const QUIZ_TYPE_LABELS = {
  chapter_gate: 'Chapter Quiz',
  chapter_practice: 'Practice Quiz',
  mix_practice: 'Mix Quiz',
};

const QUIZ_TYPE_ICONS = {
  chapter_gate: EmojiEventsRounded,
  chapter_practice: MenuBookRounded,
  mix_practice: ShuffleRounded,
};

const HISTORY_PAGE_SIZE = 10;

function formatRelativeTime(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Abhi';
  if (mins < 60) return `${mins} min pehle`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ghanta pehle`;
  const days = Math.floor(hours / 24);
  return `${days} din pehle`;
}

// Same 3-tier split as the gate's 70% pass bar — used to color-code both the
// history list's score pills and the attempt-detail score ring.
function scoreTier(percentage) {
  if (percentage >= 70) return 'high';
  if (percentage >= 40) return 'mid';
  return 'low';
}

function scoreColor(percentage) {
  if (percentage >= 70) return 'var(--success)';
  if (percentage >= 40) return 'var(--warning)';
  return 'var(--error)';
}

// Same subject icon/title lookup as FocusModal.jsx — kept as a separate literal
// (not imported) because FocusModal doesn't export it; duplicating a small
// config object is simpler than introducing a shared-constants file for one map.
const SUBJECT_META = {
  hindi:            { title: 'Hindi',                     icon: TranslateRounded, art: '✍️', description: 'Bhasha aur sahitya practice', tint: '#FFF4E6' },
  english:          { title: 'English',                   icon: AutoStoriesRounded, art: '📖', description: 'Language and literature', tint: '#EDF3FF' },
  math:             { title: 'Ganit (Math)',              icon: FunctionsRounded, art: '📐', description: 'Formula aur problem practice', tint: '#F2EFFF' },
  science:          { title: 'Vigyan (Science)',          icon: ScienceRounded, art: '🔬', description: 'Physics, Chemistry aur Biology', tint: '#EAF7F0' },
  'social-science': { title: 'Samajik Vigyan (Soc. Sci)', icon: PublicRounded, art: '🌍', description: 'History, civics aur geography', tint: '#FFF0ED' },
  sanskrit:         { title: 'Sanskrit',                  icon: MenuBookRounded, art: '🪷', description: 'Bhasha aur vyakaran practice', tint: '#FFF7E1' },
};
const SUBJECT_META_ORDER = Object.keys(SUBJECT_META);
const DEFAULT_SUBJECT_ICON = MenuBookRounded;

const sectionIcons = {
  physics:   BoltRounded,
  chemistry: ScienceRounded,
  biology:   BiotechRounded,
};

const sectionArt = {
  physics: '⚡',
  chemistry: '🧪',
  biology: '🌿',
};

const sectionDescriptions = {
  physics: 'Light, electricity aur natural phenomena',
  chemistry: 'Reactions, acids, metals aur carbon',
  biology: 'Life processes, control aur environment',
};

function QuizPageHeader({ showBack, stepTitle, onBackStep, onExit }) {
  return (
    <Box component="header" className="quiz-page-header">
      <Box className="quiz-page-header-brand">
        {showBack ? (
          <IconButton
            size="small"
            onClick={onBackStep}
            aria-label="Peeche jao"
            className="quiz-page-back-button"
          >
            <ArrowBackRounded sx={{ fontSize: 18 }} />
          </IconButton>
        ) : (
          <ZunoMark />
        )}

        <Box sx={{ minWidth: 0 }}>
          <Typography className="quiz-page-header-kicker">Zuno Practice</Typography>
          <Typography className="quiz-page-header-title">{stepTitle}</Typography>
        </Box>
      </Box>

      <Button
        size="small"
        onClick={onExit}
        startIcon={<ArrowBackRounded sx={{ fontSize: 16 }} />}
        className="quiz-page-chat-button"
      >
        <span className="quiz-page-chat-label">Chat pe wapas</span>
      </Button>
    </Box>
  );
}

function QuizPage() {
  const navigate = useNavigate();
  const goToChat = () => navigate('/chat');

  const [studyMap, setStudyMap] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [step, setStep] = useState(1); // 1=subject, 2=section+mix, 3=chapters
  const [activeSubjectId, setActiveSubjectId] = useState('');
  const [activeSectionId, setActiveSectionId] = useState('');

  const [quizConfig, setQuizConfig] = useState(null); // { quizType, subjectId, chapterId, contextTitle }
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);

  // History list — loaded once on mount, independent of the picker steps.
  const [historyAttempts, setHistoryAttempts] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState(null);

  // Attempt detail — set when a history card is clicked. Replaces the picker
  // view entirely (same idea as FocusModal's step-based slide, but this is a
  // separate mode since it can be opened from step 1 regardless of subject/
  // section state).
  const [viewingAttemptId, setViewingAttemptId] = useState(null);
  const [attemptDetail, setAttemptDetail] = useState(null);
  const [attemptDetailLoading, setAttemptDetailLoading] = useState(false);
  const [attemptDetailError, setAttemptDetailError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    fetchStudyMap()
      .then((map) => { if (isMounted) setStudyMap(map); })
      .catch((err) => { if (isMounted) setLoadError(err.message); })
      .finally(() => { if (isMounted) setIsLoading(false); });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchQuizHistory({ limit: HISTORY_PAGE_SIZE })
      .then((data) => {
        if (!isMounted) return;
        setHistoryAttempts(data.attempts || []);
        setHistoryHasMore(!!data.hasMore);
        setHistoryCursor(data.nextCursor || null);
      })
      .catch((err) => { if (isMounted) setHistoryError(err.message); })
      .finally(() => { if (isMounted) setHistoryLoading(false); });
    return () => { isMounted = false; };
  }, []);

  // Called after a fresh quiz submit — the new attempt won't appear in the
  // already-loaded history list otherwise. Simplest correct fix: reload page 1
  // (resets pagination, but a student who just finished a quiz is looking at
  // the newest attempt anyway, not mid-scroll through old ones).
  const refreshHistory = () => {
    setHistoryLoading(true);
    setHistoryError(null);
    fetchQuizHistory({ limit: HISTORY_PAGE_SIZE })
      .then((data) => {
        setHistoryAttempts(data.attempts || []);
        setHistoryHasMore(!!data.hasMore);
        setHistoryCursor(data.nextCursor || null);
      })
      .catch((err) => setHistoryError(err.message))
      .finally(() => setHistoryLoading(false));
  };

  const handleLoadMoreHistory = async () => {
    if (!historyCursor || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    try {
      const data = await fetchQuizHistory({ limit: HISTORY_PAGE_SIZE, cursor: historyCursor });
      setHistoryAttempts((prev) => [...prev, ...(data.attempts || [])]);
      setHistoryHasMore(!!data.hasMore);
      setHistoryCursor(data.nextCursor || null);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const handleOpenAttempt = (attemptId) => {
    setViewingAttemptId(attemptId);
    setAttemptDetail(null);
    setAttemptDetailError(null);
    setAttemptDetailLoading(true);
    fetchQuizAttemptDetail(attemptId)
      .then((data) => setAttemptDetail(data))
      .catch((err) => setAttemptDetailError(err.message))
      .finally(() => setAttemptDetailLoading(false));
  };

  const handleCloseAttempt = () => {
    setViewingAttemptId(null);
    setAttemptDetail(null);
    setAttemptDetailError(null);
  };

  // chapterId -> Hinglish title, used to label history cards (the API only
  // returns chapterId, never a title — same lookup pattern as FocusModal's
  // chapterTitleMap).
  const chapterTitleMap = useMemo(() => {
    const map = {};
    for (const subject of studyMap?.focusStudy?.subjects || []) {
      for (const section of subject.sections || []) {
        for (const chapter of section.chapters || []) {
          map[chapter.id] = chapter.hinglishTitle || chapter.title;
        }
      }
    }
    return map;
  }, [studyMap]);

  const getAttemptTitle = (attempt) => {
    if (attempt.chapterId && chapterTitleMap[attempt.chapterId]) {
      return chapterTitleMap[attempt.chapterId];
    }
    if (attempt.quizType === 'mix_practice') {
      const subjMeta = SUBJECT_META[attempt.subjectId];
      return `${subjMeta?.title || attempt.subjectId} — Mix Quiz`;
    }
    return QUIZ_TYPE_LABELS[attempt.quizType] || 'Quiz';
  };

  // Union of SUBJECT_META (known/placeholder subjects) and studyMap's real
  // subjects — same reasoning as FocusModal: a subject with real content must
  // always render, even if nobody added it to SUBJECT_META yet.
  const enrichedSubjects = useMemo(() => {
    const liveById = new Map((studyMap?.focusStudy?.subjects || []).map((s) => [s.id, s]));
    const allIds = [...new Set([...SUBJECT_META_ORDER, ...liveById.keys()])];

    return allIds
      .map((id) => {
        const meta = SUBJECT_META[id];
        const live = liveById.get(id);
        return {
          id,
          title: live?.hinglishTitle || live?.title || meta?.title || id,
          icon: meta?.icon || DEFAULT_SUBJECT_ICON,
          art: meta?.art || '📘',
          description: meta?.description || 'Chapter-wise practice',
          tint: meta?.tint || 'var(--primary-tint)',
          available: !!live,
        };
      })
      .sort((a, b) => {
        const ai = SUBJECT_META_ORDER.indexOf(a.id);
        const bi = SUBJECT_META_ORDER.indexOf(b.id);
        if (ai !== -1 || bi !== -1) {
          return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
        }
        return a.title.localeCompare(b.title);
      });
  }, [studyMap]);

  const subjectChapterCounts = useMemo(() => {
    const counts = {};
    for (const subject of studyMap?.focusStudy?.subjects || []) {
      const total = (subject.sections || []).reduce((acc, sec) => acc + (sec.chapters?.length || 0), 0);
      counts[subject.id || subject.title?.toLowerCase()] = total;
    }
    return counts;
  }, [studyMap]);

  const historyOverview = useMemo(() => {
    const average = historyAttempts.length
      ? Math.round(historyAttempts.reduce((sum, attempt) => sum + Number(attempt.percentage || 0), 0) / historyAttempts.length)
      : 0;
    const solved = historyAttempts.reduce((sum, attempt) => sum + Number(attempt.totalQuestions || 0), 0);
    const strong = historyAttempts.filter((attempt) => Number(attempt.percentage || 0) >= 70).length;
    return { average, solved, strong };
  }, [historyAttempts]);

  const selectedSubject = useMemo(() => {
    const subjects = studyMap?.focusStudy?.subjects || [];
    return subjects.find((s) => s.id === activeSubjectId || s.title?.toLowerCase() === activeSubjectId);
  }, [activeSubjectId, studyMap]);

  const sections = selectedSubject?.sections || [];
  const activeSection = sections.find((s) => s.id === activeSectionId);

  const handleSubjectClick = (subject) => {
    if (!subject.available) return;
    setActiveSubjectId(subject.id);
    setActiveSectionId('');
    setStep(2);
  };

  const handleSectionClick = (section) => {
    setActiveSectionId(section.id);
    setStep(3);
  };

  const handleBackStep = () => {
    if (step === 3) { setActiveSectionId(''); setStep(2); }
    else if (step === 2) { setActiveSubjectId(''); setStep(1); }
  };

  const openChapterQuiz = (chapter) => {
    setQuizConfig({
      quizType: 'chapter_practice',
      subjectId: selectedSubject.id,
      chapterId: chapter.id,
      contextTitle: chapter.hinglishTitle || chapter.title,
    });
    setIsQuizModalOpen(true);
  };

  const openMixQuiz = () => {
    setQuizConfig({
      quizType: 'mix_practice',
      subjectId: selectedSubject.id,
      chapterId: null,
      contextTitle: `${selectedSubject.hinglishTitle || selectedSubject.title} — Mix Quiz`,
    });
    setIsQuizModalOpen(true);
  };

  const stepTitle = viewingAttemptId
    ? 'Quiz Result'
    : step === 1
      ? 'Practice Quiz Hub'
      : step === 2
        ? `${selectedSubject?.hinglishTitle || selectedSubject?.title || ''} — bhaag ya Mix Quiz`
        : `${activeSection?.hinglishTitle || activeSection?.title || ''} — adhyaay chunno`;

  const handleHeaderBack = () => {
    if (viewingAttemptId) { handleCloseAttempt(); return; }
    handleBackStep();
  };

  return (
    <Box className="quiz-page-root">
      <QuizPageHeader
        showBack={!!viewingAttemptId || step > 1}
        stepTitle={stepTitle}
        onBackStep={handleHeaderBack}
        onExit={goToChat}
      />

      <Box component="main" className="quiz-page-main">
        <Box className="quiz-page-intro quiz-page-enter">
          <Box>
            <Box className="quiz-page-eyebrow"><span />Practice space</Box>
            <Typography component="h1" className="quiz-page-heading">
              {viewingAttemptId
                ? 'Apna result detail mein dekho.'
                : step === 1
                  ? 'Practice karo. Confidence badhao.'
                  : step === 2
                    ? `${selectedSubject?.hinglishTitle || selectedSubject?.title || 'Subject'} practice`
                    : `${activeSection?.hinglishTitle || activeSection?.title || 'Chapter'} quizzes`}
            </Typography>
            <Typography className="quiz-page-subheading">
              {viewingAttemptId
                ? 'Har answer ke saath clear explanation diya gaya hai.'
                : step === 1
                  ? 'Chapter choose karo ya Mix Quiz se apni Science preparation check karo.'
                  : step === 2
                    ? 'Mix Quiz lo ya kisi ek section par focus karo.'
                    : 'Ek chapter choose karo—10 MCQs ke baad instant result milega.'}
            </Typography>
          </Box>

          <Box className="quiz-streak-card">
            <span role="img" aria-label="Practice streak">🔥</span>
            <Box>
              <strong>Practice streak</strong>
              <small>Roz thoda, result bada</small>
            </Box>
          </Box>
        </Box>

        <Box className="quiz-dashboard-layout">
          <Box component="section" className="quiz-page-workspace" aria-label="Quiz selection">
            {!viewingAttemptId && isLoading && (
              <Box className="quiz-page-state">
                <CircularProgress size={28} thickness={4} sx={{ color: 'var(--primary)' }} />
                <Typography>Study Map load ho raha hai...</Typography>
              </Box>
            )}

            {!viewingAttemptId && !isLoading && loadError && (
              <Box className="quiz-page-state error">
                <span role="img" aria-label="Error">🛠️</span>
                <Typography>{loadError}</Typography>
              </Box>
            )}

            {viewingAttemptId && (
              <Box className="quiz-attempt-detail quiz-page-enter">
                {attemptDetailLoading && (
                  <Box className="quiz-page-state">
                    <CircularProgress size={28} thickness={4} sx={{ color: 'var(--primary)' }} />
                    <Typography>Result load ho raha hai...</Typography>
                  </Box>
                )}

                {!attemptDetailLoading && attemptDetailError && (
                  <Box className="quiz-page-state error">
                    <span role="img" aria-label="Error">🛠️</span>
                    <Typography>{attemptDetailError}</Typography>
                  </Box>
                )}

                {!attemptDetailLoading && attemptDetail && (
                  <>
                    <Box className={`quiz-result-hero ${scoreTier(attemptDetail.percentage)}`}>
                      <Box
                        className="quiz-result-score-ring"
                        style={{
                          '--quiz-score': `${Math.max(0, Math.min(100, Number(attemptDetail.percentage) || 0))}%`,
                          '--quiz-score-color': scoreColor(attemptDetail.percentage),
                        }}
                      >
                        <Box>
                          <strong>{attemptDetail.percentage}%</strong>
                          <span>{attemptDetail.score}/{attemptDetail.totalQuestions} correct</span>
                        </Box>
                      </Box>

                      <Box className="quiz-result-copy">
                        <Box className={`quiz-result-status ${attemptDetail.passed === false ? 'retry' : 'success'}`}>
                          {attemptDetail.passed === false
                            ? <TrendingUpRounded sx={{ fontSize: 14 }} />
                            : <CheckCircleRounded sx={{ fontSize: 14 }} />}
                          <span>
                            {attemptDetail.passed === true
                              ? 'Chapter passed'
                              : attemptDetail.passed === false
                                ? 'Keep practicing'
                                : 'Practice complete'}
                          </span>
                        </Box>
                        <Typography component="h2">
                          {attemptDetail.percentage >= 70
                            ? 'Bahut badhiya! Concept clear hai.'
                            : 'Achhi koshish—thoda revision aur.'}
                        </Typography>
                        <Typography>Har sawaal ka sahi jawab aur explanation neeche diya hai.</Typography>
                      </Box>
                    </Box>

                    <Box className="quiz-result-stats">
                      <Box>
                        <span className="success"><CheckCircleRounded sx={{ fontSize: 17 }} /></span>
                        <div><strong>{attemptDetail.score}</strong><small>Sahi jawab</small></div>
                      </Box>
                      <Box>
                        <span className="error"><TrendingUpRounded sx={{ fontSize: 17 }} /></span>
                        <div><strong>{Math.max(0, attemptDetail.totalQuestions - attemptDetail.score)}</strong><small>Galat / skipped</small></div>
                      </Box>
                      <Box>
                        <span className="primary"><ScheduleRounded sx={{ fontSize: 17 }} /></span>
                        <div><strong>{attemptDetail.timeTakenSec ? `${Math.max(1, Math.round(attemptDetail.timeTakenSec / 60))} min` : '—'}</strong><small>Total time</small></div>
                      </Box>
                    </Box>

                    <Box className="quiz-page-section-heading">
                      <Typography component="h2">Answer review</Typography>
                      <Typography>Green sahi answer hai; red tumhara incorrect selection.</Typography>
                    </Box>

                    <Box className="quiz-result-review-list">
                      {attemptDetail.results?.map((question, questionIndex) => (
                        <Box
                          key={question.questionId}
                          className={`quiz-result-review-card ${question.isCorrect ? 'correct' : 'incorrect'} quiz-page-enter`}
                          style={{ animationDelay: `${Math.min(questionIndex * 45, 260)}ms` }}
                        >
                          <Box className="quiz-result-question-row">
                            {question.isCorrect
                              ? <CheckCircleRounded sx={{ fontSize: 18, color: 'var(--success)', flexShrink: 0 }} />
                              : <TrendingUpRounded sx={{ fontSize: 18, color: 'var(--error)', flexShrink: 0 }} />}
                            <Typography>{questionIndex + 1}. {pickText(question.text)}</Typography>
                          </Box>

                          <Box className="quiz-result-options">
                            {question.options.map((option) => {
                              const isCorrectOption = option.label === question.correctOption;
                              const isWrongSelected = option.label === question.selectedOption && !question.isCorrect;
                              return (
                                <Box
                                  key={option.label}
                                  className={`quiz-result-option ${isCorrectOption ? 'correct' : isWrongSelected ? 'incorrect' : ''}`}
                                >
                                  <span>{option.label}</span>
                                  <Typography>{pickText(option.text)}</Typography>
                                </Box>
                              );
                            })}
                          </Box>

                          {pickText(question.explanation) && (
                            <Box className="quiz-result-explanation">
                              <AutoAwesomeRounded sx={{ fontSize: 15, color: 'var(--primary)', flexShrink: 0 }} />
                              <Typography>{pickText(question.explanation)}</Typography>
                            </Box>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </>
                )}
              </Box>
            )}

            {!viewingAttemptId && !isLoading && !loadError && step === 1 && (
              <>
                <Box className="quiz-page-hero quiz-page-enter">
                  <Box className="quiz-page-hero-copy">
                    <Box className="quiz-page-hero-kicker">
                      <AutoAwesomeRounded sx={{ fontSize: 14 }} />
                      Bihar Board practice
                    </Box>
                    <Typography component="h2">Apni tayari ko har chapter ke saath strong banao</Typography>
                    <Typography>
                      Subject choose karo, 10 MCQs solve karo aur turant dekho ki kaunsa concept revise karna hai.
                    </Typography>
                    <Box className="quiz-page-hero-hint">
                      <PlayArrowRounded sx={{ fontSize: 17 }} />
                      Neeche se subject select karke start karo
                    </Box>
                  </Box>

                  <Box className="quiz-page-hero-visual" aria-label="Science learning illustration">
                    <Box className="quiz-page-hero-orbit">
                      <span className="quiz-page-hero-main-art" role="img" aria-label="Microscope">🔬</span>
                      <span className="quiz-page-mini-art atom" role="img" aria-label="Atom">⚛️</span>
                      <span className="quiz-page-mini-art flask" role="img" aria-label="Chemistry flask">🧪</span>
                      <span className="quiz-page-mini-art books" role="img" aria-label="Books">📚</span>
                    </Box>
                  </Box>
                </Box>

                <Box className="quiz-overview-stats">
                  <Box className="quiz-overview-card quiz-page-enter" style={{ animationDelay: '80ms' }}>
                    <span className="primary"><HistoryRounded sx={{ fontSize: 19 }} /></span>
                    <Box><small>Recent attempts</small><strong>{historyAttempts.length}</strong><em>loaded history</em></Box>
                  </Box>
                  <Box className="quiz-overview-card quiz-page-enter" style={{ animationDelay: '130ms' }}>
                    <span className="success"><TrendingUpRounded sx={{ fontSize: 19 }} /></span>
                    <Box><small>Average score</small><strong>{historyOverview.average}%</strong><em>recent quizzes</em></Box>
                  </Box>
                  <Box className="quiz-overview-card quiz-page-enter" style={{ animationDelay: '180ms' }}>
                    <span className="info"><CheckCircleRounded sx={{ fontSize: 19 }} /></span>
                    <Box><small>Questions solved</small><strong>{historyOverview.solved}</strong><em>recent attempts</em></Box>
                  </Box>
                </Box>

                <Box className="quiz-page-section-heading">
                  <Typography component="h2">Vishay chunno</Typography>
                  <Typography>Available subject se practice start karo.</Typography>
                </Box>

                <Box className="quiz-subject-grid">
                  {enrichedSubjects.map((subject, subjectIndex) => {
                    const Icon = subject.icon;
                    return (
                      <button
                        key={subject.id}
                        type="button"
                        disabled={!subject.available}
                        className={`quiz-subject-card quiz-page-surface-card quiz-page-enter ${subject.available ? 'available' : 'unavailable'}`}
                        style={{ animationDelay: `${Math.min(subjectIndex * 55, 260)}ms` }}
                        onClick={() => handleSubjectClick(subject)}
                      >
                        <Box className="quiz-card-top-row">
                          <span className="quiz-card-icon" style={{ background: subject.tint }}>
                            <Icon sx={{ fontSize: 21 }} />
                          </span>
                          <Box className="quiz-card-art-row">
                            <span role="img" aria-label={subject.title}>{subject.art}</span>
                            {subject.available && (
                              <span className="quiz-card-arrow"><KeyboardArrowRightRounded sx={{ fontSize: 18 }} /></span>
                            )}
                          </Box>
                        </Box>
                        <strong>{subject.title}</strong>
                        <p>{subject.description}</p>
                        <small>{subject.available ? `${subjectChapterCounts[subject.id] || 0} adhyaay` : 'Jald aa raha hai'}</small>
                      </button>
                    );
                  })}
                </Box>
              </>
            )}

            {!viewingAttemptId && !isLoading && !loadError && step === 2 && selectedSubject && (
              <>
                <Box className="quiz-smart-mix-card quiz-page-enter">
                  <Box className="quiz-smart-mix-copy">
                    <span className="quiz-smart-mix-icon"><ShuffleRounded sx={{ fontSize: 25 }} /></span>
                    <Box>
                      <Typography component="h2">Smart Mix Quiz</Typography>
                      <Typography>
                        Poore {selectedSubject.hinglishTitle || selectedSubject.title} se balanced sawaal—quick revision ke liye best.
                      </Typography>
                    </Box>
                  </Box>
                  <Button variant="contained" onClick={openMixQuiz} endIcon={<PlayArrowRounded />}>
                    20 sawaal shuru karo
                  </Button>
                </Box>

                <Box className="quiz-page-section-heading">
                  <Typography component="h2">Ya section chunno</Typography>
                  <Typography>Ek section par focused practice karo.</Typography>
                </Box>

                <Box className="quiz-section-grid">
                  {sections.map((section, sectionIndex) => {
                    const sectionKey = section.title?.toLowerCase();
                    const SectionIcon = sectionIcons[sectionKey] || MenuBookRounded;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        className="quiz-section-card quiz-page-surface-card quiz-page-enter"
                        style={{ animationDelay: `${sectionIndex * 70}ms` }}
                        onClick={() => handleSectionClick(section)}
                      >
                        <Box className="quiz-card-top-row">
                          <span className="quiz-card-icon"><SectionIcon sx={{ fontSize: 21 }} /></span>
                          <Box className="quiz-card-art-row">
                            <span role="img" aria-label={section.title}>{sectionArt[sectionKey] || '📘'}</span>
                            <span className="quiz-card-arrow"><KeyboardArrowRightRounded sx={{ fontSize: 18 }} /></span>
                          </Box>
                        </Box>
                        <strong>{section.hinglishTitle || section.title}</strong>
                        <p>{sectionDescriptions[sectionKey] || 'Chapter-wise focused practice'}</p>
                        <small>{section.chapters?.length || 0} adhyaay</small>
                      </button>
                    );
                  })}
                </Box>
              </>
            )}

            {!viewingAttemptId && !isLoading && !loadError && step === 3 && activeSection && (
              <>
                <Box className="quiz-selected-section-card quiz-page-enter">
                  <span className="quiz-card-icon">
                    {React.createElement(sectionIcons[activeSection.title?.toLowerCase()] || MenuBookRounded, { sx: { fontSize: 21 } })}
                  </span>
                  <Box>
                    <Typography component="h2">{activeSection.hinglishTitle || activeSection.title}</Typography>
                    <Typography>{activeSection.chapters.length} chapter quizzes available</Typography>
                  </Box>
                </Box>

                <Box className="quiz-page-section-heading">
                  <Typography component="h2">Adhyaay chunno</Typography>
                  <Typography>Har quiz mein 10 MCQs aur instant answer review milega.</Typography>
                </Box>

                <Box className="quiz-chapter-grid">
                  {activeSection.chapters.map((chapter, chapterIndex) => (
                    <button
                      key={chapter.id}
                      type="button"
                      className="quiz-chapter-card quiz-page-surface-card quiz-page-enter"
                      style={{ animationDelay: `${Math.min(chapterIndex * 45, 260)}ms` }}
                      onClick={() => openChapterQuiz(chapter)}
                    >
                      <span className="quiz-chapter-number">{chapter.number}</span>
                      <Box>
                        <strong>{chapter.hinglishTitle || chapter.title}</strong>
                        <small><ScheduleRounded sx={{ fontSize: 12 }} />10 MCQs · instant result</small>
                      </Box>
                      <span className="quiz-card-arrow"><KeyboardArrowRightRounded sx={{ fontSize: 18 }} /></span>
                    </button>
                  ))}
                </Box>
              </>
            )}
          </Box>

          <Box component="aside" className="quiz-history-panel" aria-label="Quiz history">
            <Box className="quiz-history-header">
              <Box className="quiz-history-title-row">
                <Box className="quiz-history-title">
                  <span><HistoryRounded sx={{ fontSize: 19 }} /></span>
                  <Box>
                    <Typography component="h2">Quiz History</Typography>
                    <Typography>Recent performance</Typography>
                  </Box>
                </Box>
                <IconButton size="small" onClick={refreshHistory} aria-label="Quiz history refresh karo">
                  <RefreshRounded sx={{ fontSize: 17 }} />
                </IconButton>
              </Box>

              <Box className="quiz-history-summary">
                <Box><strong>{historyAttempts.length}</strong><small>Recent</small></Box>
                <Box><strong>{historyOverview.strong}</strong><small>70%+</small></Box>
                <Box><strong>{historyOverview.average}%</strong><small>Average</small></Box>
              </Box>
            </Box>

            <Box className="quiz-history-list">
              {historyLoading && (
                <Box className="quiz-history-state">
                  <CircularProgress size={24} thickness={4} sx={{ color: 'var(--primary)' }} />
                  <Typography>History load ho rahi hai...</Typography>
                </Box>
              )}

              {!historyLoading && historyError && (
                <Box className="quiz-history-state error"><Typography>{historyError}</Typography></Box>
              )}

              {!historyLoading && !historyError && historyAttempts.length === 0 && (
                <Box className="quiz-history-state empty">
                  <span role="img" aria-label="Notebook">📒</span>
                  <Typography component="strong">History abhi khaali hai</Typography>
                  <Typography>Pehla quiz complete karte hi result yahan dikhega.</Typography>
                </Box>
              )}

              {!historyLoading && !historyError && historyAttempts.map((attempt, attemptIndex) => {
                const AttemptIcon = QUIZ_TYPE_ICONS[attempt.quizType] || MenuBookRounded;
                const badge = attempt.passed === true ? 'Pass' : attempt.passed === false ? 'Retry' : 'Practice';
                return (
                  <button
                    key={attempt.attemptId}
                    type="button"
                    className="quiz-history-attempt quiz-page-enter"
                    style={{
                      animationDelay: `${Math.min(attemptIndex * 45, 240)}ms`,
                      '--quiz-score': `${Math.max(0, Math.min(100, Number(attempt.percentage) || 0))}%`,
                      '--quiz-score-color': scoreColor(attempt.percentage),
                    }}
                    onClick={() => handleOpenAttempt(attempt.attemptId)}
                  >
                    <span className="quiz-history-ring"><AttemptIcon sx={{ fontSize: 15 }} /></span>
                    <Box>
                      <strong>{getAttemptTitle(attempt)}</strong>
                      <small>{attempt.score}/{attempt.totalQuestions} correct · {formatRelativeTime(attempt.createdAt)}</small>
                    </Box>
                    <span className={`quiz-history-score ${scoreTier(attempt.percentage)}`}>
                      <strong>{attempt.percentage}%</strong>
                      <small className={attempt.passed === false ? 'retry' : attempt.passed === true ? 'pass' : 'practice'}>{badge}</small>
                    </span>
                  </button>
                );
              })}

              {!historyLoading && !historyError && historyHasMore && (
                <Button
                  size="small"
                  onClick={handleLoadMoreHistory}
                  disabled={historyLoadingMore}
                  className="quiz-history-more"
                >
                  {historyLoadingMore ? 'Load ho raha hai...' : 'Aur history dikhao'}
                </Button>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <QuizModal
        isOpen={isQuizModalOpen}
        quizType={quizConfig?.quizType}
        subjectId={quizConfig?.subjectId}
        chapterId={quizConfig?.chapterId}
        contextTitle={quizConfig?.contextTitle}
        onQuizComplete={refreshHistory}
        onClose={() => setIsQuizModalOpen(false)}
      />
    </Box>
  );
}

export default QuizPage;
