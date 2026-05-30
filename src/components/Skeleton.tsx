import type { CSSProperties } from 'react';

interface SkeletonProps {
  height?: number | string;
  width?: number | string;
  borderRadius?: number | string;
  style?: CSSProperties;
}

export function Skeleton({ height = 16, width = '100%', borderRadius = 8, style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{ height, width, borderRadius, flexShrink: 0, ...style }}
    />
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <Skeleton height={200} borderRadius={0} />
      <div style={{ padding: '14px 16px 16px' }}>
        <Skeleton height={10} width={70} style={{ borderRadius: 99, marginBottom: 10 }} />
        <Skeleton height={18} width="72%" style={{ marginBottom: 8 }} />
        <Skeleton height={13} width="90%" style={{ marginBottom: 5 }} />
        <Skeleton height={13} width="65%" style={{ marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Skeleton height={24} width={64} style={{ borderRadius: 99 }} />
          <Skeleton height={24} width={80} style={{ borderRadius: 99 }} />
        </div>
      </div>
    </div>
  );
}

export function ProjectDetailSkeleton() {
  return (
    <div style={{ paddingBottom: 80 }}>
      <Skeleton height={260} borderRadius={0} />
      <div className="detail-container">
        <div className="card" style={{ marginTop: -80, padding: '28px 32px', position: 'relative', zIndex: 2 }}>
          <Skeleton height={22} width={90} style={{ borderRadius: 99, marginBottom: 14 }} />
          <Skeleton height={38} width="55%" style={{ marginBottom: 12 }} />
          <Skeleton height={14} width="80%" style={{ marginBottom: 6 }} />
          <Skeleton height={14} width="65%" style={{ marginBottom: 28 }} />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 20, paddingTop: 22, borderTop: '1px solid var(--color-line)',
          }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i}>
                <Skeleton height={11} width="55%" style={{ marginBottom: 8 }} />
                <Skeleton height={26} width="45%" />
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 40 }}>
          <Skeleton height={22} width={140} style={{ marginBottom: 20 }} />
          <div className="card" style={{ height: 200 }} />
        </div>
        <div style={{ marginTop: 40 }}>
          <Skeleton height={22} width={100} style={{ marginBottom: 20 }} />
          <div className="card" style={{ overflow: 'hidden' }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ display: 'flex', gap: 16, padding: '14px 20px', borderTop: i > 0 ? '1px solid var(--color-line)' : 'none' }}>
                <Skeleton height={14} width="30%" />
                <Skeleton height={14} width={30} />
                <Skeleton height={14} width="25%" />
                <Skeleton height={14} width="20%" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
