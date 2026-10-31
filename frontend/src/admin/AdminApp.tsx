/**
 * 后台管理（/admin）—— antd 版。
 *
 * 登录（ADMIN_SECRET）→ 两个页面：
 * - 用户管理：Table 增删重置，凭证只弹一次
 * - 稿件与模板：树形查看每个用户最后一次保存的主稿和各模板 JSON，可预览/下载
 *
 * 请求全部走 src/admin/api.ts 的 alova 封装。
 */

import { useState } from 'react'
import { App as AntApp, Button, Input, InputNumber, Layout, Menu, Modal, Popconfirm, Select, Space, Spin, Table, Tag, Tree, Typography } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminUser, type AuditRow, type Credential, type TreeNode } from './api'

const { Sider, Content } = Layout
const { Text } = Typography

type PageKey = 'users' | 'tree' | 'gate' | 'logs'

export default function AdminApp() {
  return (
    <AntApp style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Shell />
    </AntApp>
  )
}

function Shell() {
  const session = useQuery({
    queryKey: ['admin-session'],
    queryFn: adminApi.session,
    retry: false,
  })

  if (session.isLoading) return <Center><Spin tip="检查登录态…" /></Center>
  if (session.isError) return <Login onSuccess={() => session.refetch()} />
  return <Dashboard onLogout={() => session.refetch()} />
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>{children}</div>
}

/* ---------------- 登录 ---------------- */

function Login({ onSuccess }: { onSuccess: () => void }) {
  const { message } = AntApp.useApp()
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () => adminApi.login(password),
    onSuccess,
    onError: (e: Error) => message.error(e.message),
  })

  return (
    <Center>
      <div style={{ width: 340, textAlign: 'center', background: '#fff', padding: '32px 28px', borderRadius: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>排版管理后台</h1>
        <p style={{ color: '#888', margin: '0 0 20px' }}>输入管理员密钥（ADMIN_SECRET）登录</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            login.mutate()
          }}
        >
          <Space.Compact block direction="vertical" style={{ display: 'block' }}>
            <Input.Password
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="管理员密钥"
              autoFocus
              size="large"
            />
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={login.isPending}
              disabled={!password}
              style={{ marginTop: 12 }}
            >
              登录
            </Button>
          </Space.Compact>
        </form>
      </div>
    </Center>
  )
}

/* ---------------- 主框架 ---------------- */

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<PageKey>('users')
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={180} style={{ background: '#fff' }}>
        <div style={{ font: '500 15px system-ui', padding: '18px 0 12px 24px' }}>排版管理</div>
        <Menu
          mode="inline"
          selectedKeys={[page]}
          onClick={({ key }) => setPage(key as PageKey)}
          items={[
            { key: 'users', label: '用户管理' },
            { key: 'tree', label: '稿件与模板' },
            { key: 'gate', label: '访问门禁' },
            { key: 'logs', label: '日志' },
          ]}
        />
        <Button
          type="text"
          block
          style={{ position: 'absolute', bottom: 16, width: 180 }}
          onClick={() => adminApi.logout().then(onLogout).catch(() => onLogout())}
        >
          退出登录
        </Button>
      </Sider>
      <Content style={{ padding: 24 }}>
        {page === 'users' ? <UsersPage /> : page === 'tree' ? <TreePage /> : page === 'gate' ? <GatePage /> : <LogsPage />}
        <Text type="secondary" style={{ fontSize: 12 }}>
          服务器版 · 凭证规则 md5(name:secret) · 链接即凭证，外传等于交出账号
        </Text>
      </Content>
    </Layout>
  )
}

/* ---------------- 访问门禁设置 ---------------- */

function GatePage() {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const cfg = useQuery({ queryKey: ['admin-gate'], queryFn: adminApi.getGate })
  const [pwd, setPwd] = useState('')
  const [minutes, setMinutes] = useState<number | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const patch: { password?: string; trialMinutes?: number } = {}
      if (pwd.trim()) patch.password = pwd.trim()
      if (minutes != null) patch.trialMinutes = minutes
      return adminApi.setGate(patch)
    },
    onSuccess: (data) => {
      setPwd('')
      setMinutes(null)
      qc.invalidateQueries({ queryKey: ['admin-gate'] })
      message.success(`已保存（${data.changed.join('、')}），即时生效；改密码会作废所有已发的密码令牌`)
    },
    onError: (e: Error) => message.error(e.message),
  })

  return (
    <div style={{ maxWidth: 520 }}>
      <Card title="访问门禁（裸域名入口）" style={{ marginBottom: 16 }}>
        <p style={{ color: '#888', fontSize: 13, marginTop: 0 }}>
          没带个人链接打开网站时需要过这道门：要么限时体验，要么输入这里的密码。改完即时生效，不用重启。
        </p>
        {cfg.isLoading ? (
          <Spin />
        ) : (
          <>
            <p>
              <Text strong>当前访问密码：</Text>
              <Text code copyable={{ text: cfg.data?.password }}>{cfg.data?.password}</Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>（发密码给对方 = 允许长期使用，不像个人链接那样隔离数据）</Text>
            </p>
            <Space.Compact block style={{ display: 'flex', marginBottom: 12 }}>
              <Input.Password
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="设置新访问密码（至少 6 位，留空=不改）"
              />
            </Space.Compact>
            <p>
              <Text strong>体验时长：</Text>
              <InputNumber
                min={1}
                max={1440}
                value={minutes ?? cfg.data?.trialMinutes}
                onChange={(v) => setMinutes(v)}
                style={{ width: 100, margin: '0 8px' }}
              />
              分钟（改完对下一次「免费体验」生效）
            </p>
            <Button type="primary" loading={save.isPending} disabled={!pwd.trim() && minutes == null} onClick={() => save.mutate()}>
              保存
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}

/* ---------------- 审计日志 ---------------- */

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  gate_trial_start: { label: '开启体验', color: 'blue' },
  gate_login_ok: { label: '密码进入', color: 'green' },
  gate_login_fail: { label: '密码错误', color: 'red' },
  gate_config_changed: { label: '门禁改配置', color: 'purple' },
  doc_push: { label: '外部推送', color: 'cyan' },
  doc_shrink_alert: { label: '稿件骤降告警', color: 'volcano' },
  cred_401: { label: '凭证被拒', color: 'orange' },
  admin_login_fail: { label: '后台登录失败', color: 'red' },
}

function LogsPage() {
  const [event, setEvent] = useState('')
  const [user, setUser] = useState('')
  const [days, setDays] = useState(7)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<AuditRow | null>(null)

  const logs = useQuery({
    queryKey: ['admin-logs', event, user, days, page],
    queryFn: () => adminApi.getLogs({ event, user, days, page }),
    placeholderData: (prev) => prev,
  })

  const columns = [
    { title: '时间', dataIndex: 'at', key: 'at', width: 150, render: fmtTime },
    {
      title: '事件',
      dataIndex: 'event',
      key: 'event',
      width: 130,
      render: (v: string) => {
        const meta = EVENT_LABELS[v]
        return <Tag color={meta?.color ?? 'default'}>{meta?.label ?? v}</Tag>
      },
    },
    { title: '用户', dataIndex: 'user', key: 'user', width: 110, render: (v: string) => v || '—' },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130 },
    {
      title: '结果',
      dataIndex: 'ok',
      key: 'ok',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="green">正常</Tag> : <Tag color="red">异常</Tag>),
    },
    {
      title: '详情',
      key: 'detail',
      render: (_: unknown, r: AuditRow) => {
        const s = JSON.stringify(r.detail)
        return s === '{}' ? (
          '—'
        ) : (
          <Button size="small" type="link" onClick={() => setDetail(r)}>
            查看
          </Button>
        )
      },
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          value={event}
          onChange={(v) => {
            setEvent(v)
            setPage(1)
          }}
          style={{ width: 150 }}
          options={[
            { value: '', label: '全部事件' },
            ...Object.entries(EVENT_LABELS).map(([value, m]) => ({ value, label: m.label })),
          ]}
        />
        <Input
          value={user}
          onChange={(e) => {
            setUser(e.target.value)
            setPage(1)
          }}
          placeholder="按用户筛选"
          style={{ width: 140 }}
          allowClear
        />
        <Select
          value={days}
          onChange={(v) => {
            setDays(v)
            setPage(1)
          }}
          style={{ width: 110 }}
          options={[
            { value: 1, label: '最近 1 天' },
            { value: 7, label: '最近 7 天' },
            { value: 30, label: '最近 30 天' },
          ]}
        />
        <Button onClick={() => logs.refetch()} loading={logs.isFetching}>刷新</Button>
        <Text type="secondary" style={{ fontSize: 12 }}>保留 30 天，自动清理</Text>
      </Space>
      <Table
        rowKey="id"
        size="middle"
        loading={logs.isLoading}
        dataSource={logs.data?.logs ?? []}
        columns={columns}
        pagination={{
          current: page,
          pageSize: 50,
          total: logs.data?.total ?? 0,
          onChange: (p) => setPage(p),
          showTotal: (t) => `共 ${t} 条`,
        }}
      />
      <Modal title={`详情 · ${EVENT_LABELS[detail?.event ?? '']?.label ?? detail?.event ?? ''}`} open={!!detail} onCancel={() => setDetail(null)} footer={null} width={560}>
        {detail && (
          <pre
            style={{
              background: '#fafafa',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.6,
              margin: 0,
              fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {`${fmtTime(detail.at)} · ${detail.user || '—'} · ${detail.ip}\n\n${JSON.stringify(detail.detail, null, 2)}`}
          </pre>
        )}
      </Modal>
    </div>
  )
}

/* ---------------- 用户管理 ---------------- */

function UsersPage() {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin-users'], queryFn: adminApi.listUsers })
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [credential, setCredential] = useState<Credential | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] })

  const add = useMutation({
    mutationFn: () => adminApi.addUser(newName.trim()),
    onSuccess: (data) => {
      setCredential(data)
      setAddOpen(false)
      setNewName('')
      invalidate()
      message.success('用户已创建')
    },
    onError: (e: Error) => message.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (name: string) => adminApi.deleteUser(name),
    onSuccess: () => {
      invalidate()
      message.success('已删除（其稿件、快照、模板一并清除）')
    },
    onError: (e: Error) => message.error(e.message),
  })
  const reset = useMutation({
    mutationFn: (name: string) => adminApi.resetUser(name),
    onSuccess: (data) => {
      setCredential(data)
      invalidate()
      message.warning('密钥已重置，旧链接全部失效')
    },
    onError: (e: Error) => message.error(e.message),
  })

  const columns = [
    { title: '名字', dataIndex: 'name', key: 'name', defaultSortOrder: 'ascend' as const },
    { title: '最后活跃', dataIndex: 'lastActive', key: 'lastActive', render: fmtTime, sorter: (a: AdminUser, b: AdminUser) => a.lastActive - b.lastActive },
    { title: '稿件大小', dataIndex: 'docBytes', key: 'docBytes', render: fmtSize },
    { title: '快照数', dataIndex: 'snapshots', key: 'snapshots' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: fmtTime },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, u: AdminUser) => (
        <Space>
          <Popconfirm
            title={`重置「${u.name}」的密钥？`}
            description="旧链接将全部失效。"
            onConfirm={() => reset.mutate(u.name)}
          >
            <Button size="small">重置密钥</Button>
          </Popconfirm>
          <Popconfirm
            title={`删除「${u.name}」？`}
            description="其全部稿件、快照、模板一并清除，不可恢复！"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove.mutate(u.name)}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setAddOpen(true)}>新增用户</Button>
        <Button onClick={() => invalidate()} loading={users.isFetching}>刷新</Button>
      </Space>
      <Table
        rowKey="name"
        size="middle"
        loading={users.isLoading}
        dataSource={users.data?.users ?? []}
        columns={columns}
        pagination={false}
      />
      <Modal
        title="新增用户"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        footer={null}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate()
          }}
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="名字（如：曹明环）"
            size="large"
            autoFocus
          />
          <Button type="primary" htmlType="submit" block size="large" loading={add.isPending} style={{ marginTop: 16 }}>
            创建（secret 自动生成）
          </Button>
        </form>
        <p style={{ color: '#888', fontSize: 12, marginBottom: 0 }}>
          创建后把 name/secret 抄进本地 skill 的 config.json（users 数组），推送时才能选到这个人。
        </p>
      </Modal>
      <CredentialModal credential={credential} onClose={() => setCredential(null)} />
    </div>
  )
}

function CredentialModal({ credential, onClose }: { credential: Credential | null; onClose: () => void }) {
  const { message } = AntApp.useApp()
  if (!credential) return null
  return (
    <Modal title={`已创建：${credential.name}`} open onCancel={onClose} footer={null}>
      <p><Text strong>凭证只展示这一次，关掉就没。</Text></p>
      <p>名字：<Text code copyable={{ text: credential.name }}>{credential.name}</Text></p>
      <p>secret：<Text code copyable={{ text: credential.secret }}>{credential.secret}</Text></p>
      <p style={{ marginBottom: 8 }}>访问链接（发给本人，链接即凭证）：</p>
      <Text code copyable={{ text: credential.viewerUrl }} style={{ display: 'block', wordBreak: 'break-all', padding: 8 }}>
        {credential.viewerUrl}
      </Text>
      <Button type="primary" block style={{ marginTop: 16 }} onClick={() => {
        // 管理员发号：一键复制可直接转发给用户的全套说明
        const text = [
          '【地理时政周刊 · 账号开通】',
          '',
          `名字：${credential.name}`,
          `密钥：${credential.secret}`,
          '',
          '━━ 怎么用 ━━',
          '',
          '■ 第一步：安装 skill（第一次需要，已安装请忽略）',
          '把 https://gitee.com/gong-wenxiang/muban_skill 发给你的 AI，说「帮我安装这个技能」。',
          '',
          '■ 第二步：把名字和密钥发给 AI',
          '说「用这个凭证把周刊推送给我」，AI 会自动验证并排版推送，然后把你的版面链接发回来。',
          '',
          '■ 第三步：打开链接看刊物',
          '在打开的页面可直接微调，点右上角「打印 / 导出 PDF」出 PDF 文件。',
          '',
          '※ 名字 + 密钥只发给你自己的 AI；忘了或泄露了找管理员（宫大人）重置。',
        ].join('\n')
        navigator.clipboard?.writeText(text)
        message.success('使用说明已复制，直接粘贴发给对方即可')
      }}>
        复制全部内容（名字 + 密钥 + 使用说明）
      </Button>
    </Modal>
  )
}

/* ---------------- 稿件与模板树 ---------------- */

function fmtTime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function TreePage() {
  const tree = useQuery({ queryKey: ['admin-tree'], queryFn: adminApi.getTree })
  const [preview, setPreview] = useState<{ title: string; user: string; target: string } | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [loadingJson, setLoadingJson] = useState(false)

  const openPreview = async (title: string, user: string, target: string) => {
    setPreview({ title, user, target })
    setLoadingJson(true)
    setJsonText('')
    try {
      setJsonText(await adminApi.getJsonRaw(user, target))
    } catch (e) {
      setJsonText(`读取失败：${(e as Error).message}`)
    } finally {
      setLoadingJson(false)
    }
  }

  const refetchJson = async () => {
    if (!preview) return
    setLoadingJson(true)
    try {
      setJsonText(await adminApi.getJsonRaw(preview.user, preview.target, true))
    } catch (e) {
      setJsonText(`读取失败：${(e as Error).message}`)
    } finally {
      setLoadingJson(false)
    }
  }

  // 格式化展示：解析成功按 2 空格缩进展开（同层级对齐、下一层缩进），失败显示原文
  const prettyJson = (() => {
    try {
      return JSON.stringify(JSON.parse(jsonText), null, 2)
    } catch {
      return jsonText
    }
  })()

  const treeData = (tree.data?.tree ?? []).map((u: TreeNode) => ({
    title: `${u.name}（${u.doc ? `主稿 ${fmtSize(u.doc.bytes)}` : '无稿件'}）`,
    key: `user:${u.name}`,
    selectable: false,
    children: [
      ...(u.doc
        ? [{
            title: `主稿 · ${fmtTime(u.doc.at)} · ${u.doc.pages} 页 · ${fmtSize(u.doc.bytes)}`,
            key: `doc:${u.name}`,
            isLeaf: true,
          }]
        : []),
      ...u.templates.map((t) => ({
        title: `模板「${t.name}」 · ${fmtTime(t.at)} · ${fmtSize(t.bytes)}`,
        key: `tpl:${u.name}:${t.id}`,
        isLeaf: true,
      })),
    ],
  }))

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={() => tree.refetch()} loading={tree.isFetching}>刷新</Button>
        <Text type="secondary">每个用户最后一次保存的主稿，及其保存的全部模板；点击查看 JSON 原文。</Text>
      </Space>
      {tree.isLoading ? <Spin /> : <Tree treeData={treeData} defaultExpandAll blockNode onSelect={(_, info) => {
        const key = String(info.node.key)
        if (key.startsWith('doc:')) {
          void openPreview(`${key.slice(4)} · 主稿 JSON`, key.slice(4), 'doc')
        } else if (key.startsWith('tpl:')) {
          const rest = key.slice(4)
          const idx = rest.indexOf(':')
          const user = rest.slice(0, idx)
          const tid = rest.slice(idx + 1)
          const node = tree.data?.tree.find((t) => t.name === user)?.templates.find((t) => t.id === tid)
          void openPreview(`${user} · 模板「${node?.name ?? tid}」JSON`, user, `tpl:${tid}`)
        }
      }} />}
      {tree.isError && <p style={{ color: '#b91c1c' }}>{(tree.error as Error).message}</p>}

      <Modal
        title={preview?.title}
        open={!!preview}
        onCancel={() => setPreview(null)}
        width={820}
        footer={
          preview && (
            <Space>
              <Button onClick={refetchJson} loading={loadingJson}>重新读取</Button>
              <Button
                type="primary"
                onClick={() => window.open(`/api/admin/json?user=${encodeURIComponent(preview.user)}&target=${encodeURIComponent(preview.target)}&download=1`)}
              >
                下载 .json
              </Button>
              <Button onClick={() => setPreview(null)}>关闭</Button>
            </Space>
          )
        }
      >
        {loadingJson ? <Spin /> : (
          <pre
            style={{
              maxHeight: 480,
              overflow: 'auto',
              background: '#fafafa',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.6,
              margin: 0,
              fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace',
              whiteSpace: 'pre',
              tabSize: 2,
            }}
          >
            {prettyJson}
          </pre>
        )}
      </Modal>
    </div>
  )
}
