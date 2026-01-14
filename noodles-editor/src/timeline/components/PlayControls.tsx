// Play controls component - play/pause/loop/speed controls

import { useTimelineStore } from '../timeline-store'

export function PlayControls() {
  const playing = useTimelineStore(state => state.playing)
  const loop = useTimelineStore(state => state.loop)
  const playbackSpeed = useTimelineStore(state => state.playbackSpeed)

  const play = useTimelineStore(state => state.play)
  const pause = useTimelineStore(state => state.pause)
  const toggleLoop = useTimelineStore(state => state.toggleLoop)
  const goToStart = useTimelineStore(state => state.goToStart)
  const goToEnd = useTimelineStore(state => state.goToEnd)
  const stepBackward = useTimelineStore(state => state.stepBackward)
  const stepForward = useTimelineStore(state => state.stepForward)
  const setPlaybackSpeed = useTimelineStore(state => state.setPlaybackSpeed)

  return (
    <div className="timeline-play-controls">
      {/* Go to start */}
      <button onClick={goToStart} title="Go to start (Home)">
        ⏮
      </button>

      {/* Step backward */}
      <button onClick={() => stepBackward(1)} title="Step backward (←)">
        ◀
      </button>

      {/* Play/Pause */}
      <button
        onClick={playing ? pause : play}
        className={playing ? 'active' : ''}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? '⏸' : '▶'}
      </button>

      {/* Step forward */}
      <button onClick={() => stepForward(1)} title="Step forward (→)">
        ▶
      </button>

      {/* Go to end */}
      <button onClick={goToEnd} title="Go to end (End)">
        ⏭
      </button>

      {/* Loop toggle */}
      <button
        onClick={toggleLoop}
        className={loop ? 'active' : ''}
        title={loop ? 'Loop on' : 'Loop off'}
      >
        🔁
      </button>

      {/* Playback speed */}
      <select
        value={playbackSpeed}
        onChange={e => setPlaybackSpeed(Number(e.target.value))}
        title="Playback speed"
        style={{
          background: '#333',
          border: '1px solid #444',
          borderRadius: 4,
          color: '#ccc',
          padding: '4px 8px',
          fontSize: 11,
        }}
      >
        <option value={0.25}>0.25x</option>
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={4}>4x</option>
      </select>
    </div>
  )
}
