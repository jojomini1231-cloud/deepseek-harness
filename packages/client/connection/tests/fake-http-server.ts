/**
 * Structural Web-carrier double recording both route registries, so a Host
 * Connection spec can mount Connection without listening on a socket.
 */

import type { WebServer, WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'

/**
 * Build a Web carrier that records the routes and upgrades registered on it.
 * @param routes - array the returned carrier appends registered routes to.
 * @param upgrades - array the returned carrier appends registered upgrades to.
 * @param host - bind host this carrier reports.
 * @param protocol - listener protocol this carrier reports.
 * @returns the carrier members Connection reads.
 */
export function fakeHttpServer(
  routes: WebRoute[],
  upgrades: WebUpgradeRoute[],
  host = '127.0.0.1',
  protocol: WebServer['protocol'] = 'http:',
): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port' | 'host' | 'protocol'> {
  return {
    host,
    protocol,
    register(route) {
      if (routes.some(candidate => candidate.kind === route.kind && candidate.path === route.path)) {
        throw new Error(`duplicate route ${route.path}`)
      }
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}
