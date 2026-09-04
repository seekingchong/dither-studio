import type { ReactNode } from 'react';
import {
  APP_DESCRIPTION,
  APP_DETAILS,
  COVER_ARROW,
  COVER_TIP,
  SELECTED_SKILL,
  SKILL_GROUPS,
  VIDEO_COVER,
} from './design';
import {
  AddGlyph,
  ArrowUpGlyph,
  BookGlyph,
  BrandMarkGlyph,
  ChartGlyph,
  ChevronUpGlyph,
  ClusterGlyph,
  CollapseGlyph,
  CommentAddGlyph,
  CursorArrowGlyph,
  HistoryGlyph,
  InfoGlyph,
  MicGlyph,
  ModelMarkGlyph,
  SkillGlyph,
} from './glyphs';

interface TdcHomeProps {
  /** 放进「video cover」容器里的东西——界面上唯一活的部分 */
  cover: ReactNode;
}

/** 左侧导航条（45:3224）：上下留白，中间三个圆按钮，底部头像 */
function NavRail() {
  return (
    <nav className="tdc-rail" aria-hidden="true">
      <span className="tdc-rail__spacer" />
      <div className="tdc-rail__group">
        <span className="tdc-rail__btn tdc-rail__btn--filled">
          <CommentAddGlyph size={18} />
        </span>
        <span className="tdc-rail__btn">
          <ClusterGlyph size={18} />
        </span>
        <span className="tdc-rail__btn tdc-rail__btn--muted">
          <BookGlyph size={18} />
        </span>
      </div>
      <span className="tdc-rail__avatar" />
    </nav>
  );
}

/** 技能分组（45:3231）：序号 + 组名 + 收起尖角，下面挂条目 */
function SkillGroupBlock({ number, name, items }: (typeof SKILL_GROUPS)[number]) {
  return (
    <div className="tdc-group">
      <div className="tdc-group__head">
        <span className="tdc-group__number">{number}</span>
        <span className="tdc-group__name">{name}</span>
        <span className="tdc-group__toggle">
          <ChevronUpGlyph size={14} />
        </span>
      </div>
      <span className="tdc-group__connector" />
      <ul className="tdc-group__items">
        {items.map((item) => (
          <li key={item} className="tdc-item" data-selected={item === SELECTED_SKILL ? 'true' : 'false'}>
            <span className="tdc-item__icon">
              <SkillGlyph size={16} />
            </span>
            <span className="tdc-item__label">{item}</span>
            {item === SELECTED_SKILL && <span className="tdc-item__mark">/</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 应用详情卡片（45:3243）：封面图 + 描述 + 详情，底下垫一团模糊的投影 */
function DetailCard({ cover }: TdcHomeProps) {
  return (
    <div className="tdc-card">
      <div className="tdc-card__panel">
        <div className="tdc-card__coverpad">
          <div className="tdc-card__cover">
            {/* 唯一动起来的容器：主窗口当前预览画面逐帧贴在这儿 */}
            <div
              className="tdc-cover__video"
              style={{
                left: VIDEO_COVER.left,
                top: VIDEO_COVER.top,
                width: VIDEO_COVER.width,
                height: VIDEO_COVER.height,
                borderRadius: VIDEO_COVER.radius,
              }}
            >
              {cover}
            </div>
            <div
              className="tdc-cover__tip"
              style={{ left: COVER_TIP.left, top: COVER_TIP.top, width: COVER_TIP.width, height: COVER_TIP.height, borderRadius: COVER_TIP.radius }}
            >
              <span className="tdc-cover__tipicon">
                <ChartGlyph size={11.083} />
              </span>
              <span className="tdc-cover__tiptitle">链路分析</span>
              <span className="tdc-cover__tipsub">Journey Analysis</span>
            </div>
            <span className="tdc-cover__arrow" style={{ left: COVER_ARROW.left, top: COVER_ARROW.top }}>
              <CursorArrowGlyph size={COVER_ARROW.size} />
            </span>
          </div>
        </div>
        <div className="tdc-card__body">
          <p className="tdc-card__desc">{APP_DESCRIPTION}</p>
          <dl className="tdc-card__details">
            {APP_DETAILS.map((row) => (
              <div key={row.label} className="tdc-detail">
                <dt className="tdc-detail__label">{row.label}</dt>
                <dd className="tdc-detail__value" data-latin={'latin' in row ? 'true' : 'false'} data-brand={'brand' in row ? 'true' : 'false'}>
                  {'icon' in row && (
                    <span className="tdc-detail__icon">
                      <InfoGlyph size={14} />
                    </span>
                  )}
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="tdc-card__glow" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

/**
 * Figma「tdc home」（45:3223）的静态复刻：左导航条 + 技能库侧栏 + 应用详情卡片 + 会话主区。
 * 除了卡片封面里的 video cover，整张界面都是死的，不接任何交互。
 */
export function TdcHome({ cover }: TdcHomeProps) {
  return (
    <div className="tdc">
      <NavRail />

      <aside className="tdc-side">
        <div className="tdc-side__logobar">
          <span className="tdc-side__logotext">智库</span>
          <span className="tdc-side__logoicon">
            <CollapseGlyph size={14} />
          </span>
        </div>

        <div className="tdc-side__list">
          <div className="tdc-side__scroll">
            <div className="tdc-side__agent">
              <span className="tdc-side__brand">
                <BrandMarkGlyph size={26} />
              </span>
              <span className="tdc-side__agentname">淘天设计智库</span>
            </div>
            <div className="tdc-side__groups">
              {SKILL_GROUPS.map((group) => (
                <SkillGroupBlock key={group.number} {...group} />
              ))}
            </div>
          </div>
          <span className="tdc-side__fade tdc-side__fade--top" aria-hidden="true" />
          <span className="tdc-side__fade tdc-side__fade--bottom" aria-hidden="true" />
        </div>

        <DetailCard cover={cover} />
      </aside>

      <section className="tdc-main">
        <div className="tdc-main__top">
          <span className="tdc-main__tab">会话</span>
          <span className="tdc-main__tabicon">
            <HistoryGlyph size={14} />
          </span>
        </div>

        <div className="tdc-input">
          <div className="tdc-input__lead">
            <span className="tdc-input__btn">
              <AddGlyph size={18} />
            </span>
            <div className="tdc-input__field">
              <span className="tdc-input__placeholder">询问任何设计问题</span>
            </div>
          </div>
          <div className="tdc-input__tail">
            <span className="tdc-input__btn">
              <MicGlyph size={18} />
            </span>
            <span className="tdc-input__btn tdc-input__btn--send">
              <ArrowUpGlyph size={18} />
            </span>
          </div>
        </div>

        <div className="tdc-foot">
          <span className="tdc-foot__mark">
            <ModelMarkGlyph size={11} />
          </span>
          <span className="tdc-foot__latin">Powered by Qwen</span>
          <span className="tdc-foot__sep" />
          <span>人工智能生成内容仅供参考</span>
        </div>
      </section>
    </div>
  );
}
