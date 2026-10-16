#!/usr/bin/env bash
# Baut ein TikTok-Video (1080x1920) aus 2-4 Clips und brennt die Texte aus texte/video-N.srt ein.
#
#   ./build.sh 1 clip1.mp4 clip2.mp4 clip3.mp4
#
# Jeder Clip wird auf 4 Sekunden gekürzt (CLIP_SEK=3 ./build.sh ... für kürzere).
# Der Ton der Clips wird entfernt, in TikTok einen Sound aus der Bibliothek wählen.
# Ergebnis: out/video-N.mp4
set -euo pipefail

cd "$(dirname "$0")"

if [ $# -lt 3 ]; then
  echo "Aufruf: ./build.sh <Nummer> <clip1> <clip2> [clip3] [clip4]" >&2
  exit 1
fi

nr="$1"; shift
srt="texte/video-$nr.srt"
[ -f "$srt" ] || { echo "Fehlt: $srt" >&2; exit 1; }
sek="${CLIP_SEK:-4}"

inputs=(); filter=""; concat=""
i=0
for clip in "$@"; do
  inputs+=(-i "$clip")
  filter+="[$i:v]trim=0:$sek,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v$i];"
  concat+="[v$i]"
  i=$((i + 1))
done

stil="FontName=Inter,Bold=1,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.6,Shadow=0,Alignment=2,MarginV=150"
filter+="${concat}concat=n=$i:v=1:a=0[cat];[cat]subtitles=$srt:force_style='$stil'[out]"

mkdir -p out
ffmpeg -y -loglevel error "${inputs[@]}" \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -filter_complex "$filter" -map "[out]" -map "$i:a" -shortest \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart \
  "out/video-$nr.mp4"

echo "Fertig: out/video-$nr.mp4"
