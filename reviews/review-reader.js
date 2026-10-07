// Shared review reader for huynh.place: renders a video review (thumbnail -> player, header,
// tags, formatted text with spoilers) and shows it in an overlay dialog. Used by the main page's
// Video Reviews preview and by /reviews/. Exposes window.ReviewReader.
// Formatted reviews are sanitized with DOMPurify; all other user text is set with textContent.
(function () {
    "use strict";

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }
    function tagsOf(r) { return Array.isArray(r.tags) ? r.tags : []; }
    function thumbUrl(id) { return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"; }
    function watchUrl(id) { return "https://www.youtube.com/watch?v=" + id; }
    function ratingClass(r) { return r >= 8 ? "rv-rating-great" : r >= 6 ? "rv-rating-good" : r >= 4 ? "rv-rating-ok" : "rv-rating-low"; }
    function formatDate(pbDate) {
        if (!pbDate) return "";
        var d = new Date(pbDate.replace(" ", "T"));
        return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
    }

    // ---------- sanitizing formatted reviews ----------

    // Only the formatting the editor produces survives; scripts, styles, images, event handlers
    // and non-http(s) links are stripped.
    var SAFE = {
        ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "s", "h2", "h3", "ol", "ul", "li", "blockquote", "a", "span", "mark"],
        ALLOWED_ATTR: ["href", "class", "data-list"],
        ALLOWED_URI_REGEXP: /^https?:\/\//i
    };
    var hasPurify = typeof window.DOMPurify !== "undefined";
    if (hasPurify) DOMPurify.addHook("afterSanitizeAttributes", function (node) {
        if (node.hasAttribute("class")) {
            // ql-indent-N = indentation level; ql-ui = Quill's list bullet/number marker;
            // ql-firstline-1 = first-line indent; ql-spoiler = hidden-until-clicked text.
            var keep = node.getAttribute("class").split(/\s+/).filter(function (c) { return /^(ql-indent-[1-8]|ql-ui|ql-firstline-1|ql-spoiler)$/.test(c); });
            if (keep.length) node.setAttribute("class", keep.join(" ")); else node.removeAttribute("class");
        }
        if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer nofollow"); }
    });
    // Without the sanitizer, formatted HTML is never used (the plain-text copy is shown instead).
    function sanitize(html) { return hasPurify ? DOMPurify.sanitize(html || "", SAFE) : ""; }

    // Inline spoilers: blacked out until clicked (or focused + Enter/Space); clicking again re-hides.
    function activateInlineSpoilers(container) {
        container.querySelectorAll(".ql-spoiler").forEach(function (s) {
            s.tabIndex = 0;
            s.setAttribute("role", "button");
            s.setAttribute("aria-pressed", "false");
            s.title = "Spoiler — click to reveal";
            var toggle = function (e) {
                e.preventDefault();
                var shown = s.classList.toggle("rv-revealed");
                s.setAttribute("aria-pressed", shown ? "true" : "false");
                s.title = shown ? "Click to hide again" : "Spoiler — click to reveal";
            };
            s.addEventListener("click", toggle);
            s.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") toggle(e); });
        });
    }

    // ---------- building blocks ----------

    // Thumbnail; the YouTube player only loads when clicked (faster page, no tracking until then).
    function makeThumb(r) {
        var thumb = el("button", "rv-thumb");
        thumb.type = "button";
        thumb.setAttribute("aria-label", "Play " + r.title);
        var img = el("img"); img.src = thumbUrl(r.videoId); img.alt = ""; img.loading = "lazy";
        thumb.appendChild(img);
        thumb.addEventListener("click", function () {
            var frame = document.createElement("iframe");
            frame.className = "rv-player";
            frame.src = "https://www.youtube-nocookie.com/embed/" + r.videoId + "?autoplay=1&rel=0";
            frame.title = r.title;
            frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            frame.allowFullscreen = true;
            thumb.replaceWith(frame);
        });
        return thumb;
    }

    function makeHead(r, tag) {
        var frag = document.createDocumentFragment();
        var head = el("div", "rv-card-head");
        var title = el("a", "rv-card-title", r.title);
        title.href = watchUrl(r.videoId); title.target = "_blank"; title.rel = "noopener noreferrer";
        if (tag) { var h = el(tag, "rv-reader-title"); h.appendChild(title); head.appendChild(h); } else head.appendChild(title);
        head.appendChild(el("span", "rv-rating " + ratingClass(r.rating), (+r.rating).toString().replace(/\.0$/, "") + "/10"));
        frag.appendChild(head);
        var meta = [r.channel, formatDate(r.watchedOn) ? "Watched " + formatDate(r.watchedOn) : ""].filter(Boolean).join(" · ");
        if (meta) frag.appendChild(el("div", "rv-meta", meta));
        return frag;
    }

    function makeReviewText(r) {
        var text;
        if (r.reviewHtml && hasPurify) {
            // Formatted review: sanitized HTML inside Quill's own styling (lists, indents, quotes).
            text = el("div", "ql-editor rv-rich");
            text.innerHTML = sanitize(r.reviewHtml);
            activateInlineSpoilers(text);
        } else {
            // Plain-text review, or the sanitizer failed to load: show the plain copy (never raw HTML).
            text = el("p", "rv-text", r.review || "");
        }
        return text;
    }

    // Whole-review spoiler flag: content sits behind a click-to-reveal cover until revealed.
    function spoilerHolder(parent, r, revealed) {
        if (!r.spoiler || revealed) return parent;
        var holder = el("div", "rv-spoiler-wrap rv-spoiler-hidden");
        var cover = el("button", "rv-spoiler-cover", "Spoiler warning — click to reveal this review");
        cover.type = "button";
        cover.addEventListener("click", function () { holder.classList.remove("rv-spoiler-hidden"); cover.remove(); });
        holder.appendChild(cover);
        parent.appendChild(holder);
        return holder;
    }

    // Tag chips; onTag(tag) handles a click (omit it for plain, non-clickable chips).
    function makeTags(r, onTag) {
        var tags = tagsOf(r);
        if (!tags.length) return null;
        var wrap = el("div", "rv-card-tags");
        tags.forEach(function (t) {
            var chip = el(onTag ? "button" : "span", "rv-chip rv-chip-small", t);
            if (onTag) {
                chip.type = "button";
                chip.addEventListener("click", function () { close(); onTag(t); });
            }
            wrap.appendChild(chip);
        });
        return wrap;
    }

    // ---------- the reader dialog ----------

    var dialog = null, content = null, setsHash = false;

    function ensureDialog() {
        if (dialog) return;
        dialog = el("dialog", "rv-dialog rv-reader");
        dialog.setAttribute("aria-label", "Full review");
        var closeBtn = el("button", "rv-reader-close", "×");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", "Close");
        content = el("div", "rv-reader-content");
        dialog.appendChild(closeBtn);
        dialog.appendChild(content);
        document.body.appendChild(dialog);
        closeBtn.addEventListener("click", close);
        dialog.addEventListener("click", function (e) { if (e.target === dialog) close(); }); // click outside the content
        // Closing (x, Esc, outside click): stop any playing video, unlock scrolling, drop #r-<id> from the address.
        dialog.addEventListener("close", function () {
            content.textContent = "";
            document.body.classList.remove("rv-noscroll");
            if (setsHash && /^#r-/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
        });
    }

    function close() { if (dialog && dialog.open) dialog.close(); }

    // opts: revealed (skip the whole-review spoiler cover), onTag(tag), onEdit() (shows an Edit
    // button), setHash (put #r-<id> in the address while open, for shareable links).
    function open(r, opts) {
        opts = opts || {};
        ensureDialog();
        setsHash = !!opts.setHash;
        content.textContent = "";
        content.appendChild(makeThumb(r));
        var body = el("div", "rv-reader-body");
        body.appendChild(makeHead(r, "h2"));
        var tags = makeTags(r, opts.onTag);
        if (tags) body.appendChild(tags);
        if (r.review || r.reviewHtml) spoilerHolder(body, r, opts.revealed).appendChild(makeReviewText(r));
        if (opts.onEdit) {
            var edit = el("button", "rv-btn rv-btn-small rv-reader-edit", "Edit");
            edit.type = "button";
            edit.addEventListener("click", function () { close(); opts.onEdit(); });
            body.appendChild(edit);
        }
        content.appendChild(body);
        if (setsHash && location.hash !== "#r-" + r.id) history.replaceState(null, "", "#r-" + r.id);
        document.body.classList.add("rv-noscroll");
        if (!dialog.open) dialog.showModal();
        dialog.scrollTop = 0;
        dialog.querySelector(".rv-reader-close").focus();
    }

    window.ReviewReader = {
        open: open, close: close,
        el: el, tagsOf: tagsOf, thumbUrl: thumbUrl, watchUrl: watchUrl, ratingClass: ratingClass, formatDate: formatDate,
        sanitize: sanitize, hasPurify: hasPurify,
        makeThumb: makeThumb, makeHead: makeHead, makeReviewText: makeReviewText, spoilerHolder: spoilerHolder, makeTags: makeTags
    };
})();
