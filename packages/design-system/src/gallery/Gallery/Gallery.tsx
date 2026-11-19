import React, { useState } from 'react'
import styles from './Gallery.module.scss'
import {
  Accordion,
  ActionBar,
  AppFrame,
  AsyncButton,
  Button,
  ConfirmDialog,
  CountBadge,
  Dialog,
  Disclosure,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FileDropZone,
  ImageFrame,
  InlineNotice,
  InspectorSection,
  KeyValueList,
  NavigationRail,
  PageHeader,
  Popover,
  ProgressBar,
  ReviewFooter,
  SearchField,
  SectionHeader,
  Select,
  Spinner,
  StageRail,
  StatusPill,
  SurfaceCard,
  Switch,
  Tabs,
  Tag,
  TechnicalDetailsDisclosure,
  TextField,
  Textarea,
  Thumbnail,
  Toolbar,
  Tooltip,
  VirtualList,
  WorkbenchLayout,
  type EmptyProps
} from '../../index'

const sampleImage = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320"><rect width="240" height="320" fill="teal"/><circle cx="120" cy="116" r="56" fill="white" fill-opacity="0.85"/><rect x="48" y="198" width="144" height="76" rx="28" fill="dimgray"/></svg>'
)}`

export const Gallery: React.FC<EmptyProps> = () => {
  const [search, setSearch] = useState('参考图')
  const [checked, setChecked] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className={styles['gallery']!} data-testid="design-system-gallery" data-theme="studio">
      <header className={styles['gallery-header']!}>
        <p className={styles['gallery-kicker']!}>agent2live</p>
        <PageHeader
          title="Design System"
          description="tokens、基础组件、浮层与工作台组合的唯一视觉来源。"
          actions={<Button>开始使用</Button>}
        />
      </header>

      <section className={styles['gallery-section']!}>
        <SectionHeader title="Actions" description="每个动作都覆盖默认、悬停、焦点、禁用与 busy 状态。" />
        <div className={styles['gallery-row']!}>
          <Button>主操作</Button>
          <Button variant="secondary">次操作</Button>
          <Button variant="quiet">安静操作</Button>
          <Button variant="danger">危险操作</Button>
          <Button disabled>禁用</Button>
          <AsyncButton busy>保存</AsyncButton>
          <AsyncButton busy busyLabel="上传中…">
            上传
          </AsyncButton>
          <Tooltip label="查看参考图">
            <Button variant="quiet">参考图</Button>
          </Tooltip>
          <Popover trigger={<Button variant="quiet">更多操作</Button>} label="更多操作">
            <p>浮层内容使用 surface 与 shadow-popover token。</p>
          </Popover>
        </div>
      </section>

      <section className={styles['gallery-section']!}>
        <SectionHeader title="Forms" />
        <div className={styles['gallery-grid']!}>
          <Field label="名称" description="显示在角色卡片上" required>
            <TextField defaultValue="未命名角色" />
          </Field>
          <Field label="错误示例" error="请选择一个有效选项">
            <TextField defaultValue="重复名称" />
          </Field>
          <Field label="备注">
            <Textarea defaultValue="保持简洁" />
          </Field>
          <Field label="状态">
            <Select defaultValue="draft">
              <option value="draft">草稿</option>
              <option value="active">启用</option>
            </Select>
          </Field>
          <div className={styles['gallery-stack']!}>
            <Switch checked={checked} onCheckedChange={setChecked} aria-label="启用" />
            <SearchField
              aria-label="搜索"
              value={search}
              onValueChange={setSearch}
              clearLabel="清除搜索"
              placeholder="搜索组件"
            />
            <FileDropZone label="上传文件" onFiles={() => undefined}>
              <span>拖入文件，或点击选择</span>
            </FileDropZone>
          </div>
        </div>
      </section>

      <section className={styles['gallery-section']!}>
        <SectionHeader title="Feedback" />
        <div className={styles['gallery-grid']!}>
          <SurfaceCard title="参考图版本" description="不可变快照">
            <p>主参考与辅助参考在同一个 ArtVersion 中锁定。</p>
          </SurfaceCard>
          <div className={styles['gallery-row']!}>
            <StatusPill label="已保存" tone="success" />
            <StatusPill label="处理中" tone="accent" />
            <StatusPill label="待确认" tone="warning" />
            <StatusPill label="失败" tone="danger" />
            <CountBadge value={12} />
            <CountBadge value={120} />
          </div>
          <div className={styles['gallery-stack']!}>
            <ProgressBar label="已完成 42%" value={42} />
            <ProgressBar label="处理中" />
            <InlineNotice tone="warning">这一步只会修改本地版本。</InlineNotice>
            <Spinner label="加载中" />
          </div>
          <EmptyState
            title="还没有候选图"
            description="先生成或上传一张画面。"
            action={<Button>新建候选</Button>}
          />
          <ErrorState
            title="素材来源已变化"
            description="提示词已更新，请重新加载素材。"
            code="ART_SOURCE_CHANGED"
            onRetry={() => undefined}
          />
        </div>
      </section>

      <section className={styles['gallery-section']!}>
        <SectionHeader title="Data display" />
        <div className={styles['gallery-grid']!}>
          <ImageFrame selected>
            <Thumbnail src={sampleImage} alt="示例参考" />
          </ImageFrame>
          <KeyValueList
            items={[
              { label: '版本', value: 'v3' },
              { label: 'hash', value: 'sha256:9f3a…' }
            ]}
          />
          <div className={styles['gallery-row']!}>
            <Tag>主参考</Tag>
            <Tag>锁定</Tag>
            <Tag>1024×1536</Tag>
          </div>
          <div className={styles['gallery-list']!}>
            <VirtualList
              items={Array.from({ length: 100 }, (_, index) => `版本 ${index + 1}`)}
              rowHeight={32}
              height={160}
              getKey={(item) => item}
              label="版本列表"
              renderItem={(item) => <div className={styles['gallery-list-item']!}>{item}</div>}
            />
          </div>
        </div>
      </section>

      <section className={styles['gallery-section']!}>
        <SectionHeader title="Navigation" />
        <div className={styles['gallery-grid']!}>
          <Tabs
            label="工作台视图"
            defaultValue="references"
            items={[
              { id: 'references', label: '参考图', content: <p>参考图与主参考顺序。</p> },
              { id: 'candidates', label: '候选', content: <p>候选图与接受动作。</p> }
            ]}
          />
          <Accordion
            items={[
              { id: 'prompt', title: '提示词', content: <p>提示词版本与来源。</p> },
              { id: 'art', title: '立绘', content: <p>立绘版本与素材。</p> }
            ]}
          />
          <Disclosure summary="生成参数">
            <p>seed、steps、cfg 与 provider。</p>
          </Disclosure>
        </div>
      </section>

      <section className={styles['gallery-section']!}>
        <SectionHeader title="Layout & patterns" />
        <StageRail
          steps={[
            { id: 'brief', label: '角色设定', status: 'complete' },
            { id: 'prompt', label: '提示词', status: 'current' },
            { id: 'art', label: '立绘', status: 'upcoming' }
          ]}
        />
        <div className={styles['gallery-workbench']!}>
          <WorkbenchLayout
            topbar={
              <div className={styles['gallery-topbar']!}>
                <strong>角色工作台</strong>
                <Button variant="quiet">保存</Button>
              </div>
            }
            context={
              <div className={styles['gallery-pane']!}>
                <SectionHeader title="上下文" />
                <p>角色与项目导航。</p>
              </div>
            }
            inspector={
              <InspectorSection title="Inspector">
                <TechnicalDetailsDisclosure summary="技术详情">
                  <p>content_hash: sha256:9f3a…</p>
                </TechnicalDetailsDisclosure>
              </InspectorSection>
            }
            actionBar={
              <ActionBar status="所有更改已保存">
                <Button>下一步</Button>
              </ActionBar>
            }
          >
            <div className={styles['gallery-pane']!}>
              <p>画布区域</p>
              <ReviewFooter
                summary="参考图 3 张"
                secondary={<Button variant="quiet">返回</Button>}
                primary={<Button>接受版本</Button>}
              />
            </div>
          </WorkbenchLayout>
        </div>
      </section>

      <section className={styles['gallery-section']!}>
        <SectionHeader title="Overlays" />
        <div className={styles['gallery-row']!}>
          <Button onClick={() => setDialogOpen(true)}>打开 Dialog</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            打开 ConfirmDialog
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            打开 Drawer
          </Button>
          <Toolbar>
            <Button variant="quiet">工具栏</Button>
          </Toolbar>
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="本地设置"
        description="修改仅影响当前设备。"
        footer={
          <>
            <Button variant="quiet" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => setDialogOpen(false)}>保存</Button>
          </>
        }
      >
        <Field label="端点">
          <TextField defaultValue="http://127.0.0.1:4317" />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        title="删除本地版本"
        destructive
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
      >
        这个操作不可撤销。
      </ConfirmDialog>
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="版本详情">
        <KeyValueList
          items={[
            { label: '来源', value: 'prompt' },
            { label: 'hash', value: 'sha256:9f3a…' }
          ]}
        />
      </Drawer>

      <div className={styles['gallery-frame']!}>
        <AppFrame
          navigation={
            <NavigationRail
              label="画廊导航"
              items={[{ id: 'gallery', label: '画廊', active: true, onSelect: () => undefined }]}
            />
          }
        >
          <div className={styles['gallery-frame-note']!}>AppFrame 预览</div>
        </AppFrame>
      </div>
    </div>
  )
}
