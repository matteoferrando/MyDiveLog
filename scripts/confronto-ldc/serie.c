#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libdivecomputer/descriptor.h>
#include <libdivecomputer/parser.h>
#include <libdivecomputer/context.h>
static FILE *uscita; static int primo_campione;
static void cb(dc_sample_type_t t, const dc_sample_value_t *v, void *ud) {
  (void)ud;
  if (t == DC_SAMPLE_DEPTH) {
    fprintf(uscita, "%s%.2f", primo_campione ? "" : ",", v->depth);
    primo_campione = 0;
  }
}
int main(int argc, char **argv) {
  dc_context_t *ctx = NULL; dc_context_new(&ctx);
  dc_descriptor_t *desc = NULL, *d = NULL; dc_iterator_t *it = NULL;
  dc_descriptor_iterator(&it);
  while (dc_iterator_next(it, &d) == DC_STATUS_SUCCESS) {
    const char *v = dc_descriptor_get_vendor(d), *p = dc_descriptor_get_product(d);
    if (v && p && !strcmp(v, "Scubapro") && !strcmp(p, "Aladin Sport Matrix")) { desc = d; break; }
    dc_descriptor_free(d);
  }
  dc_iterator_free(it);
  uscita = fopen("/tmp/serie-ldc.txt", "w");
  for (int i = 1; i < argc; i++) {
    FILE *f = fopen(argv[i], "rb"); fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    unsigned char *buf = malloc(n); if (fread(buf, 1, n, f) != (size_t)n) { fclose(f); free(buf); continue; }
    fclose(f);
    dc_parser_t *par = NULL;
    if (dc_parser_new2(&par, ctx, desc, buf, n) != DC_STATUS_SUCCESS) { free(buf); continue; }
    fprintf(uscita, "%s\t", argv[i]); primo_campione = 1;
    dc_parser_samples_foreach(par, cb, NULL);
    fprintf(uscita, "\n");
    dc_parser_destroy(par); free(buf);
  }
  fclose(uscita); dc_descriptor_free(desc); dc_context_free(ctx); return 0;
}
