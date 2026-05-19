# Animation assets

Current layout (paths the app uses out of the box, see
`src/avatar/assets.ts`):

```
public/
├── models/
│   └── Monir.glb                       # Avatar (GLB with viseme/ARKit morphs)
└── animations/
    ├── Standing W_Briefcase Idle.fbx   # idle clip
    ├── Standing Arguing.fbx            # used as the "wave" gesture clip
    └── Talking.fbx                     # talking clip
```

Override any of these by setting `VITE_AVATAR_URL` / `VITE_ANIM_IDLE` /
`VITE_ANIM_WAVE` / `VITE_ANIM_TALK` in `.env`. To add more clips, drop the
`.fbx` here and extend the `clips` map in `src/avatar/assets.ts`.

Notes
- The model must expose facial morph targets (ARKit, Oculus, or RPM naming)
  for lip sync to work. Mixamo body clips don't carry morphs — that's fine.
- Mixamo clips should be exported with their armature; TalkingHead retargets
  them onto the avatar's skeleton at load time.
- Spaces in filenames work — assets.ts URL-encodes path segments before
  handing them to the loader.
