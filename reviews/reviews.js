// Video Reviews: reads reviews from the self-hosted PocketBase (public read) and lets the
// owner (peter@huynh.place) add, edit and delete them. All user text is inserted with
// textContent, never innerHTML.
(function () {
    "use strict";

    var OWNER_EMAIL = "peter@huynh.place";
    var pb = new PocketBase("https://data.huynh.place");
    var reviews = [];
    var activeTag = null;
    var editing = null; // record being edited, or null for a new review
    var autoFilled = { title: "", channel: "" };

    var $ = function (id) { return document.getElementById(id); };
    var grid = $("rv-grid"), statusEl = $("rv-status"), tagBar = $("rv-tags");

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function isOwner() {
        var rec = pb.authStore.record || pb.authStore.model;
        return pb.authStore.isValid && rec && rec.email === OWNER_EMAIL;
    }

    // ---------- YouTube helpers ----------

    function parseVideoId(input) {
        var s = (input || "").trim();
        if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
        try {
            var u = new URL(s);
            var host = u.hostname.replace(/^www\.|^m\./, "");
            if (host === "youtu.be") return u.pathname.slice(1, 12);
            if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
                if (u.searchParams.get("v")) return u.searchParams.get("v").slice(0, 11);
                var m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
                if (m) return m[1];
            }
        } catch (e) {}
        return null;
    }

    // ---------- shared with the main page (review-reader.js) ----------
    var RR = window.ReviewReader;
    var sanitize = RR.sanitize, hasPurify = RR.hasPurify, thumbUrl = RR.thumbUrl, watchUrl = RR.watchUrl, tagsOf = RR.tagsOf,
        makeThumb = RR.makeThumb, makeHead = RR.makeHead, makeReviewText = RR.makeReviewText, spoilerHolder = RR.spoilerHolder;

    var quill = null;
    function registerFormats() {
        var Parchment = Quill.import("parchment");
        var icons = Quill.import("ui/icons");

        // First-line indent (like a book paragraph): a block-level class, ql-firstline-1, styled with text-indent.
        Quill.register(new Parchment.ClassAttributor("firstline", "ql-firstline", { scope: Parchment.Scope.BLOCK, whitelist: ["1"] }), true);
        icons.firstline =
            '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="8" x2="15" y1="4" y2="4"></line>' +
            '<line class="ql-stroke" x1="3" x2="15" y1="9" y2="9"></line><line class="ql-stroke" x1="3" x2="15" y1="14" y2="14"></line>' +
            '<polyline class="ql-stroke" points="3 2.5 5.5 4 3 5.5"></polyline></svg>';

        // Inline spoiler: <mark class="ql-spoiler">, blacked out on the page until clicked.
        // (Not <span>: Quill's base inline blot is a span, so a span format would be optimized away.)
        var Inline = Quill.import("blots/inline");
        class Spoiler extends Inline {}
        Spoiler.blotName = "spoiler";
        Spoiler.tagName = "MARK";
        Spoiler.className = "ql-spoiler";
        Quill.register(Spoiler, true);
        icons.spoiler =
            '<svg viewBox="0 0 18 18"><path class="ql-stroke" d="M2 9s2.5-4.5 7-4.5S16 9 16 9s-2.5 4.5-7 4.5S2 9 2 9z"></path>' +
            '<circle class="ql-stroke" cx="9" cy="9" r="2"></circle><line class="ql-stroke" x1="3" x2="15" y1="15" y2="3"></line></svg>';

        // Links typed without a protocol (www.example.com) become https:// instead of being dropped.
        var Link = Quill.import("formats/link");
        class SafeLink extends Link {
            static sanitize(url) {
                var u = String(url || "").trim();
                if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u.replace(/^\/+/, "");
                return super.sanitize(u);
            }
        }
        Quill.register(SafeLink, true);
    }

    function normalizeUrl(u) {
        u = (u || "").trim();
        if (!u || u === "https://") return "";
        return /^https?:\/\//i.test(u) ? u : "https://" + u.replace(/^\/+/, "");
    }

    // Plain-text copy for search and the main-page preview, with spoiler text masked out.
    function plainTextMasked(q) {
        return q.getContents().ops.map(function (op) {
            if (typeof op.insert !== "string") return "";
            return op.attributes && op.attributes.spoiler ? "[spoiler]" : op.insert;
        }).join("").replace(/\[spoiler\](\s*\[spoiler\])+/g, "[spoiler]").trim();
    }

    function getEditor() {
        if (quill) return quill;
        registerFormats();
        quill = new Quill("#rv-review-editor", {
            theme: "snow",
            placeholder: "What did you think?",
            modules: {
                toolbar: {
                    container: [
                        [{ header: [2, 3, false] }],
                        ["bold", "italic", "underline", "strike"],
                        [{ list: "ordered" }, { list: "bullet" }],
                        ["firstline", { indent: "-1" }, { indent: "+1" }],
                        ["blockquote", "link", "spoiler"],
                        ["clean"]
                    ],
                    handlers: {
                        firstline: function () {
                            var on = this.quill.getFormat().firstline;
                            this.quill.format("firstline", on ? false : "1", "user");
                        },
                        spoiler: function () {
                            var range = this.quill.getSelection();
                            if (!range || !range.length) { window.alert("Select the text you want to hide as a spoiler first."); return; }
                            this.quill.format("spoiler", !this.quill.getFormat(range).spoiler, "user");
                        },
                        // Simple prompt instead of Quill's inline link box (whose Enter key submitted the whole review form).
                        link: function () {
                            var range = this.quill.getSelection();
                            if (!range || !range.length) { window.alert("Select the text you want to turn into a link first."); return; }
                            var current = this.quill.getFormat(range).link || "https://";
                            var answer = window.prompt("Link address (leave empty to remove the link):", current);
                            if (answer === null) return;
                            var url = normalizeUrl(answer);
                            this.quill.setSelection(range, "silent");
                            this.quill.format("link", url || false, "user");
                        }
                    }
                },
                keyboard: {
                    bindings: {
                        // In lists (and already-indented blocks) Quill's built-in Tab binding nests/indents first.
                        // Otherwise: Tab at the start of a paragraph indents its first line; pressing it again
                        // there indents the whole paragraph; Tab mid-text inserts a tab character.
                        tab: {
                            key: "Tab",
                            handler: function (range, context) {
                                if (context.offset === 0 && range.length === 0) {
                                    if (!context.format.firstline) this.quill.formatLine(range.index, 1, "firstline", "1", "user");
                                    else this.quill.format("indent", "+1", "user");
                                    return false;
                                }
                                this.quill.deleteText(range.index, range.length, "user");
                                this.quill.insertText(range.index, "\t", "user");
                                this.quill.setSelection(range.index + 1, 0, "silent");
                                return false;
                            }
                        },
                        // Shift+Tab: remove the first-line indent if there is one, otherwise outdent.
                        outdentAnywhere: {
                            key: "Tab",
                            shiftKey: true,
                            handler: function (range, context) {
                                if (context.format.firstline) this.quill.formatLine(range.index, 1, "firstline", false, "user");
                                else this.quill.format("indent", "-1", "user");
                                return false;
                            }
                        }
                    }
                }
            }
        });
        return quill;
    }

    function fetchVideoInfo(id) {
        var target = encodeURIComponent(watchUrl(id));
        return fetch("https://www.youtube.com/oembed?format=json&url=" + target)
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .catch(function () {
                return fetch("https://noembed.com/embed?url=" + target).then(function (r) { return r.json(); });
            })
            .then(function (d) { return { title: d.title || "", channel: d.author_name || "" }; });
    }

    // ---------- rendering ----------

    function matches(r, q) {
        if (activeTag && tagsOf(r).indexOf(activeTag) < 0) return false;
        if (!q) return true;
        var hay = [r.title, r.channel, r.review, tagsOf(r).join(" ")].join(" ").toLowerCase();
        return hay.indexOf(q) >= 0;
    }

    function sorted(list) {
        var mode = $("rv-sort").value;
        var when = function (r) { return r.watchedOn || r.created || ""; };
        return list.slice().sort(function (a, b) {
            if (mode === "rating") return (b.rating - a.rating) || when(b).localeCompare(when(a));
            if (mode === "oldest") return when(a).localeCompare(when(b));
            return when(b).localeCompare(when(a));
        });
    }

    function renderTagBar() {
        tagBar.textContent = "";
        var counts = {};
        reviews.forEach(function (r) { tagsOf(r).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
        var tags = Object.keys(counts).sort();
        if (!tags.length) return;
        [null].concat(tags).forEach(function (t) {
            var b = el("button", "rv-chip" + (activeTag === t ? " rv-chip-active" : ""), t == null ? "All" : t + " (" + counts[t] + ")");
            b.type = "button";
            b.addEventListener("click", function () { activeTag = t; render(); });
            tagBar.appendChild(b);
        });
    }

    function onTagClick(t) { activeTag = t; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    function makeTags(r) { return RR.makeTags(r, onTagClick); }

    function renderCard(r) {
        var card = el("article", "rv-card");
        card.id = "r-" + r.id; // linked from the main site's preview, e.g. /reviews/#r-<id>
        card.appendChild(makeThumb(r));

        var body = el("div", "rv-body");
        body.appendChild(makeHead(r));

        if (r.review || r.reviewHtml) {
            var holder = spoilerHolder(body, r, false);
            var text = makeReviewText(r);
            holder.appendChild(text);
            var plain = r.review || text.textContent;
            if (plain.length > 320 || plain.split("\n").length > 5) {
                text.classList.add("rv-clamped");
                var more = el("button", "rv-more", "Read more");
                more.type = "button";
                // Opens the full review in the reader; if the card's spoiler cover was already
                // clicked, the reader doesn't ask again.
                more.addEventListener("click", function () { openReader(r, !holder.classList.contains("rv-spoiler-hidden")); });
                holder.appendChild(more);
            }
        }

        var tags = makeTags(r);
        if (tags) body.appendChild(tags);

        if (isOwner()) {
            var edit = el("button", "rv-btn rv-btn-small rv-edit", "Edit");
            edit.type = "button";
            edit.addEventListener("click", function () { openEditor(r); });
            body.appendChild(edit);
        }

        card.appendChild(body);
        return card;
    }

    // Full review in the shared reader overlay (with an Edit button when logged in as the owner).
    function openReader(r, revealed) {
        RR.open(r, { revealed: revealed, setHash: true, onTag: onTagClick, onEdit: isOwner() ? function () { openEditor(r); } : null });
    }

    function render() {
        renderTagBar();
        var q = $("rv-search").value.trim().toLowerCase();
        var list = sorted(reviews.filter(function (r) { return matches(r, q); }));
        grid.textContent = "";
        list.forEach(function (r) { grid.appendChild(renderCard(r)); });
        if (!reviews.length) statusEl.textContent = isOwner() ? "No reviews yet. Click “+ New review” to add your first." : "No reviews yet. Check back soon!";
        else if (!list.length) statusEl.textContent = "No reviews match your search.";
        else statusEl.textContent = list.length === reviews.length ? reviews.length + (reviews.length === 1 ? " review" : " reviews") : "Showing " + list.length + " of " + reviews.length;
    }

    // Arriving via /reviews/#r-<id> (e.g. from the main page): open that review in the reader.
    // Spoiler-flagged reviews still show their cover first.
    var linkedDone = false;
    function focusLinkedReview() {
        if (linkedDone || !/^#r-[a-z0-9]+$/.test(location.hash)) return;
        linkedDone = true;
        var id = location.hash.slice(3);
        var r = reviews.filter(function (x) { return x.id === id; })[0];
        var card = document.getElementById("r-" + id);
        if (card) {
            card.scrollIntoView({ block: "start" });
            card.classList.add("rv-highlight");
            setTimeout(function () { card.classList.remove("rv-highlight"); }, 2500);
        }
        if (r) openReader(r, false);
    }

    function load() {
        return pb.collection("video_reviews").getFullList({ sort: "-created" })
            .then(function (items) { reviews = items; render(); focusLinkedReview(); })
            .catch(function (e) { console.error(e); statusEl.textContent = "Couldn't load reviews right now. Please try again later."; });
    }

    // ---------- auth ----------

    function updateAuthUi() {
        $("rv-auth").textContent = pb.authStore.isValid ? "Log out" : "Log in";
        $("rv-new").hidden = !isOwner();
    }

    $("rv-auth").addEventListener("click", function () {
        if (pb.authStore.isValid) { pb.authStore.clear(); updateAuthUi(); render(); return; }
        $("rv-login-error").hidden = true;
        $("rv-login").showModal();
        $("rv-login-password").focus();
    });

    $("rv-login-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var err = $("rv-login-error");
        pb.collection("users").authWithPassword($("rv-login-email").value.trim(), $("rv-login-password").value)
            .then(function () {
                $("rv-login-password").value = "";
                if (!isOwner()) {
                    // Valid account, but not the owner: don't keep a session that can't do anything here.
                    pb.authStore.clear();
                    err.textContent = "Only the site owner can add reviews.";
                    err.hidden = false;
                    return;
                }
                $("rv-login").close();
                updateAuthUi(); render();
            })
            .catch(function () { err.textContent = "Incorrect email or password."; err.hidden = false; });
    });

    // ---------- editor ----------

    function setPreview(id, info) {
        var p = $("rv-preview");
        if (!id) { p.hidden = true; return; }
        $("rv-preview-img").src = thumbUrl(id);
        $("rv-preview-title").textContent = info ? info.title : "";
        $("rv-preview-channel").textContent = info && info.channel ? info.channel : "";
        p.hidden = false;
    }

    var urlTimer;
    $("rv-url").addEventListener("input", function () {
        clearTimeout(urlTimer);
        urlTimer = setTimeout(function () {
            var id = parseVideoId($("rv-url").value);
            setPreview(id, null);
            if (!id) return;
            fetchVideoInfo(id).then(function (info) {
                if (parseVideoId($("rv-url").value) !== id) return; // link changed meanwhile
                setPreview(id, info);
                // Only overwrite fields the user hasn't typed into themselves.
                if (!$("rv-title").value || $("rv-title").value === autoFilled.title) $("rv-title").value = autoFilled.title = info.title;
                if (!$("rv-channel").value || $("rv-channel").value === autoFilled.channel) $("rv-channel").value = autoFilled.channel = info.channel;
            }).catch(function () {});
        }, 350);
    });

    function openEditor(r) {
        editing = r || null;
        autoFilled = { title: "", channel: "" };
        $("rv-form-title").textContent = r ? "Edit review" : "New review";
        $("rv-url").value = r ? watchUrl(r.videoId) : "";
        $("rv-title").value = r ? r.title : "";
        $("rv-channel").value = r ? r.channel || "" : "";
        $("rv-rating").value = r ? r.rating : "";
        $("rv-watched").value = r && r.watchedOn ? r.watchedOn.slice(0, 10) : new Date().toISOString().slice(0, 10);
        $("rv-tags-input").value = r ? tagsOf(r).join(", ") : "";
        $("rv-spoiler").checked = !!(r && r.spoiler);
        var editor = getEditor();
        editor.setContents([], "silent");
        if (r && r.reviewHtml && hasPurify) editor.clipboard.dangerouslyPasteHTML(sanitize(r.reviewHtml), "silent");
        else if (r && r.review) editor.setText(r.review, "silent");
        editor.history.clear();
        $("rv-delete").hidden = !r;
        $("rv-form-error").hidden = true;
        setPreview(r ? r.videoId : null, r ? { title: r.title, channel: r.channel } : null);
        $("rv-editor").showModal();
        if (r) editor.focus(); else $("rv-url").focus();
    }

    $("rv-new").addEventListener("click", function () { openEditor(null); });

    // Enter inside Quill's own link box (shown when clicking an existing link) must not submit the review form.
    $("rv-form").addEventListener("keydown", function (e) {
        if (e.key === "Enter" && e.target.closest && e.target.closest(".ql-tooltip")) e.preventDefault();
    });

    $("rv-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var err = $("rv-form-error");
        var id = parseVideoId($("rv-url").value);
        if (!id) { err.textContent = "That doesn't look like a YouTube video link."; err.hidden = false; return; }
        var rec = pb.authStore.record || pb.authStore.model;
        var data = {
            user: rec.id,
            videoId: id,
            title: $("rv-title").value.trim(),
            channel: $("rv-channel").value.trim(),
            rating: parseFloat($("rv-rating").value),
            // Plain-text copy powers search and the main site's preview snippets; the HTML keeps the formatting.
            // (spoiler text is masked as "[spoiler]" in the plain copy so it can't leak there).
            review: plainTextMasked(getEditor()).slice(0, 20000),
            reviewHtml: getEditor().getText().trim() ? sanitize(getEditor().root.innerHTML) : "",
            spoiler: $("rv-spoiler").checked,
            tags: $("rv-tags-input").value.split(",").map(function (t) { return t.trim().toLowerCase(); })
                .filter(function (t, i, a) { return t && a.indexOf(t) === i; }).slice(0, 12),
            watchedOn: $("rv-watched").value ? $("rv-watched").value + " 12:00:00.000Z" : ""
        };
        var save = editing ? pb.collection("video_reviews").update(editing.id, data) : pb.collection("video_reviews").create(data);
        save.then(function () { $("rv-editor").close(); return load(); })
            .catch(function (e2) { console.error(e2); err.textContent = "Couldn't save the review. Are you still logged in?"; err.hidden = false; });
    });

    $("rv-delete").addEventListener("click", function () {
        if (!editing || !window.confirm("Delete your review of “" + editing.title + "”?")) return;
        pb.collection("video_reviews").delete(editing.id)
            .then(function () { $("rv-editor").close(); return load(); })
            .catch(function () { var err = $("rv-form-error"); err.textContent = "Couldn't delete the review."; err.hidden = false; });
    });

    document.querySelectorAll("[data-close]").forEach(function (b) {
        b.addEventListener("click", function () { b.closest("dialog").close(); });
    });

    // ---------- toolbar + theme ----------

    $("rv-search").addEventListener("input", render);
    $("rv-sort").addEventListener("change", render);

    $("theme-toggle").addEventListener("click", function () {
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        if (isDark) document.documentElement.removeAttribute("data-theme");
        else document.documentElement.setAttribute("data-theme", "dark");
        try { localStorage.setItem("theme", isDark ? "light" : "dark"); } catch (e) {}
    });

    updateAuthUi();
    load();
})();
