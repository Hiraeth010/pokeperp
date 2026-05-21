//! Source merkle root for PriceUpdate audit trail.
//! Spec: docs/publisher.md §7, docs/oracle.md §4 (source_root field).

use crate::sources::SoldListing;
use sha2::{Digest, Sha256};

/// Hash a single sale leaf.
/// Leaf encoding: SHA-256(constituent_index || listing_id || price || sold_at || source).
pub fn leaf(constituent_index: u8, l: &SoldListing) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([constituent_index]);
    h.update(l.listing_id.as_bytes());
    h.update(l.price_microusdc.to_le_bytes());
    h.update(l.sold_at_unix.to_le_bytes());
    h.update(l.source.as_bytes());
    h.finalize().into()
}

/// Build the merkle root over a list of pre-hashed leaves.
/// Leaves should be ordered by (constituent_index, listing_id) before calling.
pub fn root(leaves: Vec<[u8; 32]>) -> [u8; 32] {
    if leaves.is_empty() {
        return [0u8; 32];
    }
    let mut layer = leaves;
    while layer.len() > 1 {
        let mut next = Vec::with_capacity((layer.len() + 1) / 2);
        for pair in layer.chunks(2) {
            let combined = if pair.len() == 2 {
                hash_pair(&pair[0], &pair[1])
            } else {
                pair[0]
            };
            next.push(combined);
        }
        layer = next;
    }
    layer[0]
}

fn hash_pair(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(a);
    h.update(b);
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_root_is_zero() {
        assert_eq!(root(vec![]), [0u8; 32]);
    }

    #[test]
    fn single_leaf_root_is_leaf() {
        let l = [1u8; 32];
        assert_eq!(root(vec![l]), l);
    }

    #[test]
    fn two_leaves_root_is_hash_pair() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        assert_eq!(root(vec![a, b]), hash_pair(&a, &b));
    }
}
