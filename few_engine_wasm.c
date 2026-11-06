/* few_engine_wasm.c — 通用高速引擎(WebAssembly 版,所有平台/浏览器通用,含 iPhone)
 * 由 few_scan.c 的位级已验证核心(advance_seed/sim_level/match_seed)移植,无 libc、freestanding。
 * 内存 ABI(i32):
 *   CFG[0] = 级数 nlv;每级 30 个 i32(基址 CFG+1+i*30):
 *     [0..8]=g9,[9..17]=cap9,[18]=gc,[19]=skip,[20]=has_obs,[21..29]=obs
 *   OUT:命中种子 u32 数组(容量 200000)
 * 导出:cfg_addr() / out_addr() / scan(from,to,stop1)→命中数(写入 OUT)
 * cur0 恒为全 0(与网页端 ZERO8... 即全 0 基准一致)
 * 编译:zig cc --target=wasm32-freestanding -O3 -nostdlib -Wl,--no-entry \
 *      -Wl,--export=cfg_addr -Wl,--export=out_addr -Wl,--export=scan -o few_engine.wasm few_engine_wasm.c
 */
typedef int i32;
typedef unsigned u32;
typedef long long i64;
#define MULT 0x6C078965u

#define MAXLV 256
#define OUTCAP 200000
static i32 CFG[1 + MAXLV * 30];
static u32 OUT[OUTCAP];

i32 *cfg_addr(void) { return CFG; }
u32 *out_addr(void) { return OUT; }

static u32 advance_seed(u32 seed) {
    u32 x  = seed ^ (seed >> 30);
    u32 s0 = x * MULT;
    u32 s1 = (s0 ^ (s0 >> 30)) * MULT + 1u;
    u32 s2 = (s1 ^ (s1 >> 30)) * MULT + 2u;
    u32 s3 = (s2 ^ (s2 >> 30)) * MULT + 3u;
    u32 t  = (x * 0x3C4B2800u) ^ s0;
    return (t ^ (t >> 8) ^ s3 ^ (s3 >> 19)) & 0x7FFFFFFFu;
}

/* 与 few_scan.c sim_level 逐步对应(四阶段:资格/掷点≤4轮/加权补足/输出) */
static void sim_level(u32 seed, i32 *cfg, const i32 *cur, i32 *gains9) {
    u32 x  = seed ^ (seed >> 30);
    u32 st0 = x * MULT;
    u32 st1 = (st0 ^ (st0 >> 30)) * MULT + 1u;
    u32 st2 = (st1 ^ (st1 >> 30)) * MULT + 2u;
    u32 st3 = (st2 ^ (st2 >> 30)) * MULT + 3u;
    u32 t, nxt;

    i32 stats[9], gain[9], n = 0, i;
    for (i = 0; i < 9; i++)
        if (cfg[i] >= 1 && cur[i] < cfg[9 + i]) { stats[n] = i; n++; }

    i32 rerollT = 1, a = cfg[18], b = n;
    if (a < 1) a = 1; if (b < a) a = b; if (a > 1) rerollT = a;
    i32 fillT = cfg[18] < n ? cfg[18] : n;

    i32 rolls = 0, nz = 0, k;
    for (i32 p = 0; p < 4; p++) {
        nz = 0;
        for (k = 0; k < n; k++) {
            i32 g = cfg[stats[k]], base = g / 100, res = g % 100, gv;
            if (res == 0) gv = base;
            else {
                t = st0 ^ (st0 << 11);
                nxt = (t ^ (t >> 8) ^ st3 ^ (st3 >> 19));
                st0 = st1; st1 = st2; st2 = st3; st3 = nxt;
                gv = base + (((nxt & 0x7FFFFFFFu) % 1000000u) < (u32)(res * 10000) ? 1 : 0);
            }
            gain[stats[k]] = gv;
            if (gv > 0) nz++;
        }
        rolls++;
        if (nz >= rerollT || rolls >= 4) break;
    }
    i32 deficit = fillT - nz;
    for (i32 d = 0; d < deficit; d++) {
        u32 total = 0;
        for (k = 0; k < n; k++) { i32 kk = stats[k]; if (gain[kk] == 0) total += (u32)(cfg[kk] * 100); }
        if (total == 0) break;
        t = st0 ^ (st0 << 11);
        nxt = (t ^ (t >> 8) ^ st3 ^ (st3 >> 19));
        st0 = st1; st1 = st2; st2 = st3; st3 = nxt;
        u32 rem = (nxt & 0x7FFFFFFFu) % total;
        for (k = 0; k < n; k++) {
            i32 kk = stats[k];
            if (gain[kk] != 0) continue;
            if ((i64)rem < (i64)(cfg[kk] * 100)) { gain[kk] = 1; break; }
            rem -= (u32)(cfg[kk] * 100);
        }
    }
    for (k = 0; k < 9; k++) gains9[k] = 0;
    for (k = 0; k < n; k++) gains9[stats[k]] = gain[stats[k]];
}

static i32 match_seed(u32 seed) {
    i32 nlv = CFG[0], cur[9], gains9[9], j;
    for (j = 0; j < 9; j++) cur[j] = 0;                  /* cur0 恒为全 0 */
    for (i32 i = 0; i < nlv; i++) {
        i32 *cfg = CFG + 1 + i * 30;
        for (i32 s = 0; s < cfg[19]; s++) seed = advance_seed(seed);
        sim_level(seed, cfg, cur, gains9);
        if (cfg[20])
            for (j = 0; j < 9; j++) if (gains9[j] != cfg[21 + j]) return 0;
        for (j = 0; j < 9; j++) {
            i32 add = gains9[j] > 0 ? (gains9[j] < cfg[9 + j] - cur[j] ? gains9[j] : cfg[9 + j] - cur[j]) : 0;
            cur[j] += add > 0 ? add : 0;
        }
        seed = advance_seed(seed);
    }
    return 1;
}

i32 scan(u32 from, u32 to, i32 stop1) {
    u32 m = 0;
    for (u32 s = from; s <= to; s++) {
        if (match_seed(s)) {
            OUT[m++] = s;
            if (m >= OUTCAP) break;
            if (stop1) break;
        }
    }
    return (i32)m;
}
