// Pure payload builder for the self-update helper container. No imports so
// tests load it directly.
//
// Why a helper at all: a container cannot recreate ITSELF — `compose up -d`
// run inside homeport dies the moment compose stops homeport, leaving the
// update half-applied. So homeport launches a short-lived sibling (its own
// image — it already ships docker-cli + compose) that performs
// `compose pull && compose up -d` from outside and auto-removes itself.

export interface SelfUpdateInput {
  /** homeport's own image ref (helper reuses it — already present locally). */
  image: string
  /** Host path of the compose project dir (from the compose working_dir label). */
  projectDir: string
  /** Compose project name (compose -p). */
  project: string
  /** DOCKER_HOST the helper must use (same proxy homeport talks to; '' = socket). */
  dockerHost: string
  /** Networks to join so DOCKER_HOST is reachable (homeport's own networks). */
  networks: string[]
}

export const HELPER_LABEL = 'homeport.self-updater'

export function buildHelperPayload(input: SelfUpdateInput) {
  const env = ['HOMEPORT_HELPER=1']
  if (input.dockerHost) env.push(`DOCKER_HOST=${input.dockerHost}`)
  return {
    name: `homeport-self-update-${Date.now().toString(36)}`,
    Image: input.image,
    Entrypoint: ['/bin/sh', '-c'],
    Cmd: [
      // pull first so the window where homeport is down is as short as possible
      `cd ${input.projectDir} && docker compose -p ${input.project} pull && docker compose -p ${input.project} up -d`,
    ],
    Env: env,
    Labels: { [HELPER_LABEL]: 'true' },
    // The project dir is mounted at the SAME path it has on the host. Compose
    // resolves relative binds (./stacks) against its cwd and sends ABSOLUTE
    // paths to the daemon, which interprets them on the HOST — a /project
    // mount would recreate homeport with binds pointing at host /project/*
    // (that bug shipped in v2.3.0 and bit a real deployment).
    WorkingDir: input.projectDir,
    HostConfig: {
      Binds: [`${input.projectDir}:${input.projectDir}`],
      // Keep the exited helper around (label-tagged) so its logs are
      // debuggable; the next self-update removes old helpers first.
      AutoRemove: false,
      RestartPolicy: { Name: 'no' },
    },
    NetworkingConfig: input.networks.length
      ? { EndpointsConfig: Object.fromEntries(input.networks.map((n) => [n, {}])) }
      : undefined,
  }
}

/** Validate the inspect data of homeport's own container before self-updating. */
export function selfUpdatePlan(inspect: {
  Config?: { Image?: string; Labels?: Record<string, string> }
  NetworkSettings?: { Networks?: Record<string, unknown> }
}): { ok: true; project: string; projectDir: string; image: string; networks: string[] } | { ok: false; reason: string } {
  const labels = inspect.Config?.Labels ?? {}
  const project = labels['com.docker.compose.project'] || ''
  const projectDir = labels['com.docker.compose.project.working_dir'] || ''
  const image = inspect.Config?.Image || ''
  if (!project || !projectDir) {
    return {
      ok: false,
      reason: 'homeport is not compose-managed — self-update needs the compose project labels (run it via docker compose)',
    }
  }
  if (!image) return { ok: false, reason: 'could not determine the running image' }
  return { ok: true, project, projectDir, image, networks: Object.keys(inspect.NetworkSettings?.Networks ?? {}) }
}
