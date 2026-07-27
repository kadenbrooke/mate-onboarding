import { describe, it, expect } from "vitest"
import {
  checkUrlForSsrf,
  isPrivateIp,
  isPrivateIpv4,
  isPrivateIpv6,
} from "./ssrf"

describe("isPrivateIpv4 (H3b SSRF ranges)", () => {
  it("flags loopback, RFC1918, link-local, CGNAT, and 0.0.0.0/8", () => {
    expect(isPrivateIpv4([127, 0, 0, 1])).toBe(true)
    expect(isPrivateIpv4([10, 0, 0, 5])).toBe(true)
    expect(isPrivateIpv4([172, 16, 3, 4])).toBe(true)
    expect(isPrivateIpv4([172, 31, 255, 255])).toBe(true)
    expect(isPrivateIpv4([192, 168, 1, 1])).toBe(true)
    expect(isPrivateIpv4([169, 254, 169, 254])).toBe(true) // cloud metadata
    expect(isPrivateIpv4([100, 64, 0, 1])).toBe(true) // CGNAT
    expect(isPrivateIpv4([0, 0, 0, 0])).toBe(true)
  })

  it("allows genuine public IPs", () => {
    expect(isPrivateIpv4([8, 8, 8, 8])).toBe(false)
    expect(isPrivateIpv4([1, 1, 1, 1])).toBe(false)
    expect(isPrivateIpv4([172, 15, 0, 1])).toBe(false) // just below 172.16/12
    expect(isPrivateIpv4([172, 32, 0, 1])).toBe(false) // just above 172.16/12
  })
})

describe("isPrivateIpv6", () => {
  it("flags loopback, unspecified, link-local, unique-local", () => {
    expect(isPrivateIpv6("::1")).toBe(true)
    expect(isPrivateIpv6("::")).toBe(true)
    expect(isPrivateIpv6("fe80::1")).toBe(true)
    expect(isPrivateIpv6("fc00::1")).toBe(true)
    expect(isPrivateIpv6("fd12:3456::1")).toBe(true)
  })

  it("flags IPv4-mapped addresses whose embedded v4 is private", () => {
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateIpv6("::ffff:169.254.169.254")).toBe(true)
    expect(isPrivateIpv6("::ffff:8.8.8.8")).toBe(false)
  })

  it("allows a public IPv6", () => {
    expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false)
  })
})

describe("isPrivateIp (dispatch)", () => {
  it("routes v4 and v6 literals correctly", () => {
    expect(isPrivateIp("10.1.2.3")).toBe(true)
    expect(isPrivateIp("::1")).toBe(true)
    expect(isPrivateIp("8.8.8.8")).toBe(false)
  })
})

describe("checkUrlForSsrf (static pre-check)", () => {
  it("rejects non-http(s) schemes", () => {
    expect(checkUrlForSsrf("file:///etc/passwd").ok).toBe(false)
    expect(checkUrlForSsrf("gopher://evil").ok).toBe(false)
    expect(checkUrlForSsrf("ftp://host/x").ok).toBe(false)
  })

  it("rejects localhost and private-IP literal hosts", () => {
    expect(checkUrlForSsrf("http://localhost/admin").ok).toBe(false)
    expect(checkUrlForSsrf("http://127.0.0.1:8080/").ok).toBe(false)
    expect(checkUrlForSsrf("http://169.254.169.254/latest/meta-data/").ok).toBe(false)
    expect(checkUrlForSsrf("http://[::1]/").ok).toBe(false)
    expect(checkUrlForSsrf("http://192.168.0.10/").ok).toBe(false)
  })

  it("rejects malformed URLs", () => {
    expect(checkUrlForSsrf("not a url").ok).toBe(false)
    expect(checkUrlForSsrf("http://").ok).toBe(false)
  })

  it("allows a public hostname but flags it as needing DNS re-check", () => {
    const r = checkUrlForSsrf("https://acmeplumbing.com/")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hostname).toBe("acmeplumbing.com")
      expect(r.isIpLiteral).toBe(false)
    }
  })

  it("allows a public IP literal without needing DNS", () => {
    const r = checkUrlForSsrf("http://8.8.8.8/")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.isIpLiteral).toBe(true)
  })
})
