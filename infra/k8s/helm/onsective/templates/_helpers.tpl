{{/* Common labels */}}
{{- define "onsective.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/part-of: onsective
app.kubernetes.io/managed-by: Helm
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "onsective.image" -}}
{{- printf "%s/%s:%s" .Values.global.imageRegistry .image .Values.global.imageTag -}}
{{- end -}}

{{- define "onsective.envFrom" -}}
- secretRef:
    name: {{ .Values.global.envFromSecret }}
{{- end -}}
